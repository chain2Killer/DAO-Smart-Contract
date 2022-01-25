import { Fragment, useRef, useState, useEffect } from 'react';
import useNotify from './notify'
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import * as anchor from "@project-serum/anchor";
import {AccountLayout,MintLayout,TOKEN_PROGRAM_ID,Token,ASSOCIATED_TOKEN_PROGRAM_ID} from "@solana/spl-token";
import { programs } from '@metaplex/js'
import moment from 'moment';
import {
  Connection,
  Keypair,
  Signer,
  PublicKey,
  Transaction,
  TransactionSignature,
  ConfirmOptions,
  sendAndConfirmRawTransaction,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  Commitment,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  clusterApiUrl,
  SystemProgram,
} from "@solana/web3.js";

let wallet : any
let conn = new Connection(clusterApiUrl('devnet'))
let notify : any
const { metadata: { Metadata } } = programs
const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
const programId = new PublicKey('Ebo3DJjKqeLyZripRcEfbjdhtSENa5xCCXy8YxLUQiuG')
const idl = require('./solana_anchor.json')

const confirmOption : ConfirmOptions = {
    commitment : 'finalized',
    preflightCommitment : 'finalized',
    skipPreflight : false
}

let POOL = new PublicKey('GKZLqL1o6gK93BCtpE4piRNVsmxzSmzSNZ723sgvpf7Q')
const POOL_LEDGER_SIZE =8 +32+8+8+8+ 17 * 365 * 10;

const createAssociatedTokenAccountInstruction = (
  associatedTokenAddress: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey,
  walletAddress: anchor.web3.PublicKey,
  splTokenMintAddress: anchor.web3.PublicKey
    ) => {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
    { pubkey: walletAddress, isSigner: false, isWritable: false },
    { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];
  return new anchor.web3.TransactionInstruction({
    keys,
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([]),
  });
}

const getTokenWallet = async (
  wallet: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey
    ) => {
  return (
    await anchor.web3.PublicKey.findProgramAddress(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )[0];
};

async function storeTransaction(hash : string, transactionType? : string){
  let now = (new Date()).toUTCString()
  localStorage.setItem(now,JSON.stringify({
    type : transactionType,
    hash : hash
  }))
}

async function sendTransaction(transaction : Transaction,signers : Keypair[], transactionType? : string) {
  try{
    transaction.feePayer = wallet.publicKey
    transaction.recentBlockhash = (await conn.getRecentBlockhash('max')).blockhash
    await transaction.setSigners(wallet.publicKey,...signers.map(s => s.publicKey))
    if(signers.length != 0)
      await transaction.partialSign(...signers)
    const signedTransaction = await wallet.signTransaction(transaction)
    let hash = await conn.sendRawTransaction(await signedTransaction.serialize())
    await conn.confirmTransaction(hash)
    notify('success', 'Success!', hash)
    storeTransaction(hash,transactionType)
  } catch(err) {
    console.log(err)
    notify('error', 'Failed Instruction!')
  }
}

async function initPool(
  saleToken : PublicKey,
  stakeToken : PublicKey,
  period : number
  ){
  console.log("+ init pool")
  let provider = new anchor.Provider(conn, wallet as any, confirmOption)
  let program = new anchor.Program(idl,programId,provider)
  let randomPubkey = Keypair.generate().publicKey
  let [pool, bump] = await PublicKey.findProgramAddress([randomPubkey.toBuffer()],programId)

  let transaction = new Transaction()

  let lamports = await conn.getMinimumBalanceForRentExemption(POOL_LEDGER_SIZE)
  let poolLedger = Keypair.generate()
  let saleAccount = await getTokenWallet(pool,saleToken)
  let stakeAccount = await getTokenWallet(pool,stakeToken)
  transaction.add(createAssociatedTokenAccountInstruction(saleAccount, wallet.publicKey, pool, saleToken))
  transaction.add(createAssociatedTokenAccountInstruction(stakeAccount, wallet.publicKey, pool, stakeToken))
  transaction.add(SystemProgram.createAccount({
      fromPubkey : wallet.publicKey,
      lamports : lamports,
      newAccountPubkey : poolLedger.publicKey,
      programId : programId,
      space : POOL_LEDGER_SIZE,
  }))
  let now = moment().startOf('minute')
  transaction.add(await program.instruction.initPool(
    new anchor.BN(bump), 
    new anchor.BN(now.unix()), 
    new anchor.BN(period),
    { 
      accounts : {
        owner : wallet.publicKey,
        pool : pool,
        poolLedger : poolLedger.publicKey,
        rand : randomPubkey,
        saleMint : saleToken,
        saleAccount : saleAccount,
        stakeMint : stakeToken,
        stakeAccount : stakeAccount,
        systemProgram : SystemProgram.programId
    }}
  ))
  await sendTransaction(transaction, [poolLedger],"create pool")
  return pool
}

async function stake(
  poolAddress : string,
  amount : number
  ){
  console.log("+ stake")
  let pool = new PublicKey(poolAddress)
  let provider = new anchor.Provider(conn, wallet as any, confirmOption)
  let program = new anchor.Program(idl,programId,provider)
  let poolData = await program.account.pool.fetch(pool)
  let decimals = await getDecimalsOfToken(poolData.stakeMint)
  let nft_mint = Keypair.generate()
  let rent = await conn.getMinimumBalanceForRentExemption(MintLayout.span)
  let nft_account = await getTokenWallet(wallet.publicKey,nft_mint.publicKey)
  let metadata = (await PublicKey.findProgramAddress([Buffer.from('metadata'),TOKEN_METADATA_PROGRAM_ID.toBuffer(),nft_mint.publicKey.toBuffer()],TOKEN_METADATA_PROGRAM_ID))[0]
  let master_endition = (await PublicKey.findProgramAddress([Buffer.from('metadata'),TOKEN_METADATA_PROGRAM_ID.toBuffer(),nft_mint.publicKey.toBuffer(),Buffer.from('edition')],TOKEN_METADATA_PROGRAM_ID))[0]
  let [metadataExtended,bump] = await PublicKey.findProgramAddress([nft_mint.publicKey.toBuffer()],programId)
  let stakeAccount = await getTokenWallet(wallet.publicKey, poolData.stakeMint)
  let transaction = new Transaction()
  transaction.add(
    SystemProgram.createAccount({
        fromPubkey : wallet.publicKey,
        newAccountPubkey : nft_mint.publicKey,
        space : MintLayout.span,
        lamports : rent,
        programId : TOKEN_PROGRAM_ID,
    }),
    Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        nft_mint.publicKey,
        0,
        wallet.publicKey,
        wallet.publicKey
    ),
    createAssociatedTokenAccountInstruction(
        nft_account,
        wallet.publicKey,
        wallet.publicKey,
        nft_mint.publicKey,
    ),
    Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        nft_mint.publicKey,
        nft_account,
        wallet.publicKey,
        [],
        1
    ),
  )
  transaction.add(await program.instruction.stakeToken(
    new anchor.BN(bump),
    new anchor.BN(amount * Math.pow(10, decimals)),
    {
      accounts : {
        owner : wallet.publicKey,
        pool : pool,
        poolLedger : poolData.poolLedger,
        sourceStakeAccount : stakeAccount,
        destStakeAccount : poolData.stakeAccount,
        nftMint : nft_mint.publicKey,
        metadata : metadata,
        masterEdition : master_endition,
        metadataExtended : metadataExtended,
        tokenProgram : TOKEN_PROGRAM_ID,
        tokenMetadataProgram : TOKEN_METADATA_PROGRAM_ID,
        systemProgram : SystemProgram.programId,
        rent : SYSVAR_RENT_PUBKEY,
        clock : SYSVAR_CLOCK_PUBKEY
      }
    }
  ))
  await sendTransaction(transaction, [nft_mint], "stake")   
}

async function unstake(
  poolAddress : string,
  mint : PublicKey
  ){
  console.log("+ unstake")
  let pool = new PublicKey(poolAddress)
  let provider = new anchor.Provider(conn, wallet as any, confirmOption)
  let program = new anchor.Program(idl,programId,provider)
  let poolData = await program.account.pool.fetch(pool)
  let stakeAccount = await getTokenWallet(wallet.publicKey, poolData.stakeMint)
  let [metadataExtended,bump] = await PublicKey.findProgramAddress([mint.toBuffer()],programId) 
  let nftAccount = await getTokenWallet(wallet.publicKey, mint)
  let transaction=new Transaction()
  if((await conn.getAccountInfo(stakeAccount)) == null)
    transaction.add(createAssociatedTokenAccountInstruction(stakeAccount,wallet.publicKey,wallet.publicKey,poolData.stakeMint))
  transaction.add(await program.instruction.unstakeToken(
    {
      accounts:{
        owner : wallet.publicKey,
        pool : pool,
        poolLedger : poolData.poolLedger,
        nftMint : mint,
        nftAccount : nftAccount,
        metadataExtended : metadataExtended,
        sourceStakeAccount : poolData.stakeAccount,
        destStakeAccount : stakeAccount,
        tokenProgram : TOKEN_PROGRAM_ID,
        clock : SYSVAR_CLOCK_PUBKEY,
      }
    }
  ))
  await sendTransaction(transaction,[], "unstake")
}

async function deposit(
  poolAddress : string,
  amount : number
  ){
  console.log("+ deposit")
  let pool = new PublicKey(poolAddress)
  let provider = new anchor.Provider(conn, wallet as any, confirmOption)
  let program = new anchor.Program(idl,programId,provider)
  let poolData = await program.account.pool.fetch(pool)
  let saleAccount = await getTokenWallet(wallet.publicKey, poolData.saleMint)  
  let transaction = new Transaction()
  let decimals = await getDecimalsOfToken(poolData.saleMint)
  transaction.add(await program.instruction.deposit(
    new anchor.BN(amount * Math.pow(10, decimals)),
    {
      accounts:{
        owner : wallet.publicKey,
        pool : pool,
        poolLedger : poolData.poolLedger,
        sourceSaleAccount : saleAccount,
        destSaleAccount : poolData.saleAccount,
        tokenProgram : TOKEN_PROGRAM_ID,
        clock : SYSVAR_CLOCK_PUBKEY
      }
    }
  ))
  await sendTransaction(transaction,[], "deposit")
}

async function withdraw(
  poolAddress : string,
  mint : PublicKey,
  ){
  console.log("+ withdraw")
  let pool = new PublicKey(poolAddress)
  let provider = new anchor.Provider(conn, wallet as any, confirmOption)
  let program = new anchor.Program(idl,programId,provider)
  let poolData = await program.account.pool.fetch(pool)
  let [metadataExtended,bump] = await PublicKey.findProgramAddress([mint.toBuffer()],programId)
  let saleAccount = await getTokenWallet(wallet.publicKey, poolData.saleMint)
  let transaction=new Transaction()
  if((await conn.getAccountInfo(saleAccount)) == null)
    transaction.add(createAssociatedTokenAccountInstruction(saleAccount,wallet.publicKey,wallet.publicKey,poolData.saleMint))
  let nftAccount = await getTokenWallet(wallet.publicKey, mint)
  transaction.add(await program.instruction.withdraw(
    {
      accounts:{
        owner : wallet.publicKey,
        pool : pool,
        poolLedger : poolData.poolLedger,
        nftMint : mint,
        nftAccount : nftAccount,
        metadataExtended : metadataExtended,
        sourceSaleAccount : poolData.saleAccount,
        destSaleAccount : saleAccount,
        tokenProgram : TOKEN_PROGRAM_ID,
        clock : SYSVAR_CLOCK_PUBKEY,
      }
    }
  ))
  await sendTransaction(transaction,[], "withdraw")  
}

let stakedNfts : any[] = []
export async function getStakeNftsForOwner(
    owner: PublicKey,
    pool : PublicKey,
    ){
    let rwallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,rwallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    const allTokens: any = []
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID
    });
    for (let index = 0; index < tokenAccounts.value.length; index++) {
        const tokenAccount = tokenAccounts.value[index];
        const tokenAmount = tokenAccount.account.data.parsed.info.tokenAmount;
        const mint = new PublicKey(tokenAccount.account.data.parsed.info.mint)
        if (tokenAmount.amount == "1" && tokenAmount.decimals == "0") {
            let [metadataExtended,bump] = await PublicKey.findProgramAddress([mint.toBuffer()],programId)
            if((await conn.getAccountInfo(metadataExtended)) == null) continue;
            try {
                let metadataExtendedData = await program.account.metadataExtended.fetch(metadataExtended)
                if(metadataExtendedData.pool.toBase58() == pool.toBase58() && metadataExtendedData.values.toNumber() != 0){
                    allTokens.push({
                        mint : mint,
                        values : metadataExtendedData.values.toNumber(),
                        number : metadataExtendedData.number.toNumber(),
                        withdrawNumber : metadataExtendedData.number.toNumber(),
                    })
                }
            } catch (err) {

            }
        }
    }
    return allTokens
}

let pD : any = null;
async function getPoolData(
  poolAddress : String
  ){
  try{
    let pool = new PublicKey(poolAddress)
    let rwallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,rwallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    pD = {
      saleMint : poolData.saleMint.toBase58(),
      saleAccount : poolData.saleAccount.toBase58(),
      saleDecimals : await getDecimalsOfToken(poolData.saleMint),
      stakeMint : poolData.stakeMint.toBase58(),
      stakeAccount : poolData.stakeAccount.toBase58(),
      stakeDecimals : await getDecimalsOfToken(poolData.stakeMint),
      startAt : poolData.startAt.toNumber(),
      period : poolData.period.toNumber(),
    }
  } catch(err){
    pD=null
  }
}

async function getDecimalsOfToken(
  mint : PublicKey
  ){
  let resp = await conn.getAccountInfo(mint)
  let accountData = MintLayout.decode(Buffer.from(resp!.data))
  return accountData.decimals
}

let pDLedger : any[] = [];
async function getPoolLedgerData(
  poolAddress : string,
  allLedger : boolean,
  ){
  pDLedger = []
  try{
    await getPoolData(poolAddress)
    let pool = new PublicKey(poolAddress)
    let rwallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,rwallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    let last = poolLedgerData.lastNumber.toNumber()
    let start = last > 6 ? last-6 : 0
    start = allLedger ? 0 : start
    for(let i = start; i<last+2; i++){
      let ledger = poolLedgerData.ledger[i]
      pDLedger.push({
        no : i,
        totalStakeToken : ledger.totalStakeToken.toNumber(),
        income : ledger.income.toNumber(),
        changed : ledger.changed
      })
    }
  }catch(err){
    pDLedger = []
  }
}

let stakerData : any = {
  stakeAmount : 0,
  saleAmount : 0,
  stakedAmount : 0,
  totalWithdrawableAmount : 0,
}
let withdrawableAmounts : any[] = []
async function getStakerData(
  poolAddress : string,
  ){
  try{
  let pool = new PublicKey(poolAddress)
  let rwallet = new anchor.Wallet(Keypair.generate())
  let provider = new anchor.Provider(conn,rwallet,confirmOption)
  const program = new anchor.Program(idl,programId,provider)
  let poolData = await program.account.pool.fetch(pool)
  let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
  let stakeAccount = await getTokenWallet(wallet.publicKey, poolData.stakeMint)
  let saleAccount = await getTokenWallet(wallet.publicKey, poolData.saleMint)
  let stakeAmount = 0
  let stakeDecimals = 0
  let stakeValue : any;
  if((await conn.getAccountInfo(stakeAccount))){
    stakeValue = (await conn.getTokenAccountBalance(stakeAccount)).value as any
    stakeAmount = Number(stakeValue.uiAmount)
  }
  stakeDecimals = await getDecimalsOfToken(poolData.stakeMint)
  let saleAmount = 0
  let saleDecimals = 0
  let saleValue : any;
  if((await conn.getAccountInfo(saleAccount))){
    saleValue = (await conn.getTokenAccountBalance(saleAccount))?.value as any
    saleAmount = Number(saleValue.uiAmount)
  }
  saleDecimals = await getDecimalsOfToken(poolData.saleMint)
  stakedNfts = await getStakeNftsForOwner(wallet.publicKey, pool)
  let withdrawableAmount = 0
  withdrawableAmounts = []
  for(let nft of stakedNfts){
    let temp = (await getWithdrawableAmountForNft(pool,nft.mint)) 
    withdrawableAmounts.push(temp / Math.pow(10, saleDecimals))
    withdrawableAmount += temp
  }
  withdrawableAmount = withdrawableAmount / Math.pow(10,saleDecimals)
  console.log(stakedNfts)
  let stakedAmount = 0
  for(let i=0; i<stakedNfts.length; i++){
    stakedNfts[i].values /= Math.pow(10,stakeDecimals)
    stakedAmount += stakedNfts[i].values
  }
  stakerData = {
    stakeAmount : stakeAmount,
    saleAmount : saleAmount,
    stakedAmount : stakedAmount,
    totalWithdrawableAmount : withdrawableAmount
  }
  } catch(err) {
    console.log(err)
  }
}

const MAX_LEDGER_LEN = 365 * 10
export async function getWithdrawableAmountForNft(
    pool : PublicKey,
    nftMint : PublicKey,
    ) {
    let rwallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,rwallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    let [metadataExtended,bump] = await PublicKey.findProgramAddress([nftMint.toBuffer()],programId)
    try {
      let metadataExtendedData = await program.account.metadataExtended.fetch(metadataExtended)
      let amount = metadataExtendedData.values.toNumber()
      if(metadataExtendedData.pool.toBase58() != pool.toBase58() || amount == 0) return 0
      let first = metadataExtendedData.withdrawNumber.toNumber()
      let last = Math.floor((moment().unix() - poolData.startAt.toNumber()) / poolData.period.toNumber())
      if(last >= MAX_LEDGER_LEN)
        last = MAX_LEDGER_LEN
      let total = 0
      for(let i = first ; i < last; i++){
          let ledger = poolLedgerData.ledger[i]
          if(!ledger.changed || ledger.income.toNumber() == 0) continue
          if(ledger.totalStakeToken.toNumber()!=0)
              total += Math.floor(ledger.income.toNumber() * amount / ledger.totalStakeToken.toNumber())
      }
      return total;        
    } catch(err) {
        return 0
    }
}

let init = true;
export default function Stake(){
	wallet = useWallet()
	notify = useNotify()
	const [changed, setChange] = useState(true)
	const [period, setPeriod] = useState(60)
	const [saleToken, setSaleToken] = useState('5Pdw82Xqs6kzSZf2p472LbKb4FqegtQkgoaXCnE4URfa')
  const [stakeToken, setStakeToken] = useState('FwSgEjN1okgGomujPCLAbS8S3JjpWMGahKEnHoBfjZ5G')
  const [poolAddress, setPoolAddress] = useState(POOL.toBase58())
  const [showPoolData, setShowPoolData] = useState(false)
  const [showPoolLedgerData, setShowPoolLedgerData] = useState(false)
  const [showAllLedger, setShowAllLedger] = useState(false)
  const [stakeAmount, setStakeAmount] = useState(0)
  const [depositAmount, setDepositAmount] = useState(0)
	const render = () => {
		setChange(!changed)
	}

	return <div className="container-fluid mt-4">
    <h3>Admin Page</h3>
    <h6>{"Pool  :  " +  POOL.toBase58()}</h6>
		<div className="row mb-3">
			<div className="col-lg-2">
				<div className="input-group">
					<div className="input-group-prepend">
						<span className="input-group-text">Period(s)</span>
					</div>
					<input name="period"  type="number" className="form-control" onChange={(event)=>{setPeriod(Number(event.target.value))}} value={period}/>
				</div>
			</div>
      <div className="col-lg-4">
        <div className="input-group">
          <div className="input-group-prepend">
            <span className="input-group-text">Sale Token</span>
          </div>
          <input name="saleToken"  type="text" className="form-control" onChange={(event)=>{setSaleToken(event.target.value)}} value={saleToken}/>
        </div>
      </div>
      <div className="col-lg-4">
        <div className="input-group">
          <div className="input-group-prepend">
            <span className="input-group-text">Stake Token</span>
          </div>
          <input name="stakeToken"  type="text" className="form-control" onChange={(event)=>{setStakeToken(event.target.value)}} value={stakeToken}/>
        </div>
      </div>
			<div className="col-lg-2">
				<button type="button" className="btn btn-warning" onClick={async () =>{
					POOL = await initPool(new PublicKey(saleToken), new PublicKey(stakeToken), period)
					render()
        }}>
          Create Staking Pool
        </button>
      </div>
		</div>
    <hr/>
    <h3>User Page</h3>
		<div className="row mb-3">
      <div className="col-lg-4">
        <div className="input-group mb-2">
          <div className="input-group-prepend">
            <span className="input-group-text">Pool Address</span>
          </div>
          <input name="poolAddress"  type="text" className="form-control" onChange={(event)=>{setPoolAddress(event.target.value)}} value={poolAddress}/>
        </div>
        <button className="btn btn-success" onClick={async ()=> {
          await getPoolData(poolAddress)
          setShowPoolData(!showPoolData)
        }}>{showPoolData ? "Hide Pool Data" : "Show Pool Data"}</button>
        <button className="btn btn-danger" onClick={async ()=> {
          await getPoolLedgerData(poolAddress, showAllLedger)
          setShowPoolLedgerData(!showPoolLedgerData)
        }}>{showPoolLedgerData ? "Hide Pool Ledger Data" : "Show Pool Ledger Data"}</button>
        <div className="form-check">
            <input type="checkbox" className="form-check-input" onChange={async ()=>{
              await getPoolLedgerData(poolAddress, !showAllLedger)
              setShowAllLedger(!showAllLedger)
            }}/>Show all ledger
        </div>
        {
          pD != null ?
            showPoolData &&
            <div>
              <h6>{"Sale Mint : " + pD.saleMint}</h6>
              <h6>{"Sale Account : " + pD.saleAccount}</h6>
              <h6>{"Stake Mint : " + pD.stakeMint}</h6>
              <h6>{"Stake Account : " + pD.stakeAccount}</h6>
              <h6>{"Period : " + pD.period + "(s)"}</h6>
            </div>
          :
            showPoolData && <h6>Invalid Pool Address</h6>
        }
        {
          showPoolLedgerData && 
          <table className="table table-hover">
            <thead><tr><th>Number</th><th>Total Staked Account</th><th>Income</th></tr></thead>
            <tbody>
            {
              pDLedger.map((item,idx)=>{
                let color=""
                if(item.changed)
                  return <tr className="table-success" key={idx}>
                    <td>{item.no}</td>
                    <td>{item.totalStakeToken / Math.pow(10, pD.stakeDecimals)}</td>
                    <td>{item.income / Math.pow(10, pD.saleDecimals)}</td>
                  </tr>
                else
                  return <tr><td>{item.no}</td><td>No Change</td></tr>
              })
            }
            </tbody>
          </table>
        }
      </div>
      {
        (wallet && wallet.publicKey!=null) && 
        <div className="col-lg-8">
          <div>
            <button className="btn-sm btn-warning" onClick={async ()=>{
              await getStakerData(poolAddress)
              render()
            }}>Get My Data</button>
            <h6>{"Stake Token Amount : " + stakerData.stakeAmount}</h6>
            <h6>{"Sale Token Amount : " + stakerData.saleAmount}</h6>
          </div>
          <div className="row mb-3">
            <div className="col-sm-6">
            <div className="input-group">
              <input type="number" className="form-control" placeholder="Type staking amount.." name="stakeAmount" onChange={(event)=>{setStakeAmount(Number(event.target.value))}} value={stakeAmount}/>
              <div className="input-group-append">
                <button className="btn btn-success" onClick={async ()=>{
                  await stake(poolAddress,stakeAmount)
                  await getStakerData(poolAddress)
                  setStakeAmount(0)
                }}>Stake</button>
              </div>
            </div>
            </div>
            <div className="col-sm-6">
            <div className="input-group">
              <input type="number" className="form-control" placeholder="Type income amount.." name="depositAmount" onChange={(event)=>{setDepositAmount(Number(event.target.value))}} value={depositAmount}/>
              <div className="input-group-append">
                <button className="btn btn-success" onClick={async ()=>{
                  await deposit(poolAddress,depositAmount)
                  await getStakerData(poolAddress)
                  setDepositAmount(0)
                }}>Deposit</button>
              </div>
            </div>
            </div>
          </div>
          <table className="table table-hover">
            <thead><tr><th>Address</th><th>Values</th><th>Withdrawable Amount</th><th></th></tr></thead>
            <tbody>
            {
              stakedNfts.map((item,idx)=>{
                return <tr key={idx}>
                  <td>{item.mint.toBase58()}</td>
                  <td>{item.values}</td>
                  <td>{withdrawableAmounts[idx]}</td>
                  <td>
                    <button className="btn-sm btn-danger" onClick={async ()=>{
                      await unstake(poolAddress, item.mint)
                      await getStakerData(poolAddress)
                      render()
                    }}>Unstake</button>
                    <button className="btn-sm btn-primary" onClick={async ()=>{
                      await withdraw(poolAddress, item.mint)
                      await getStakerData(poolAddress)
                      render()
                    }}>Withdraw</button>
                  </td>
                </tr>
              })
            }
            <tr className="table-danger"><td>Total</td><td>{stakerData.stakedAmount}</td><td>{stakerData.totalWithdrawableAmount}</td></tr>
            </tbody>
          </table>
        </div>
      }
		</div>
	</div>
}