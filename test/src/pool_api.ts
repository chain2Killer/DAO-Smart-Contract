
import {
  Connection,
  Keypair,
  Signer,
  PublicKey,
  Transaction,
  TransactionSignature,
  ConfirmOptions,
  sendAndConfirmRawTransaction,
  sendAndConfirmTransaction,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  Commitment,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY
} from "@solana/web3.js";
import * as splToken from '@solana/spl-token'
import fs from 'fs'
import * as anchor from '@project-serum/anchor'
import moment from 'moment'
import * as logger from './logger'

const confirmOption : ConfirmOptions = {
    commitment : 'finalized',
    preflightCommitment : 'finalized',
    skipPreflight : false
}

const sleep = (ms : number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export let programId = new PublicKey('58qtsHK1a2f1rZZpxVaDUVCazLujizDxWaYYxBZTFqJj')
const idl=JSON.parse(fs.readFileSync('src/solana_anchor.json','utf8'))
const POOL_LEDGER_SIZE =8+ 32+8+8+ 16 * 365 * 10

export async function initPool(
    conn : Connection,
    owner : Keypair,
    sale_mint : PublicKey,
    stake_mint : PublicKey,
    // mint_price : number,
    // start_at : number,
    period : number,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let randomPubkey = Keypair.generate().publicKey
    let poolLedger = Keypair.generate()
    let [pool, bump] = await PublicKey.findProgramAddress(
        [randomPubkey.toBuffer()],
        programId
    )
    let saleMint = new splToken.Token(conn,sale_mint,splToken.TOKEN_PROGRAM_ID,owner)
    let saleAccount = await saleMint.createAccount(pool)
    let stakeMint = new splToken.Token(conn,stake_mint,splToken.TOKEN_PROGRAM_ID,owner)
    let stakeAccount = await stakeMint.createAccount(pool)

    let transaction = new Transaction()
    let lamports = await conn.getMinimumBalanceForRentExemption(POOL_LEDGER_SIZE)
    transaction.add(SystemProgram.createAccount({
        fromPubkey : owner.publicKey,
        lamports : lamports,
        newAccountPubkey : poolLedger.publicKey,
        programId : programId,
        space : POOL_LEDGER_SIZE,
    }))
    const tx = await sendAndConfirmTransaction(conn,transaction,[owner,poolLedger],confirmOption)
    logger.debug("    TX: Create poolLedger account tx: ", tx)
    let now = moment().startOf('minute')
    logger.log("Start date in the pool ledger is  ", now.format('MMMMDoYYYYThh:mm:ss') )

    try {
        const tx = await program.rpc.initPool(
            new anchor.BN(bump),
            // new anchor.BN(mint_price),
            // new anchor.BN(mint_price),
            new anchor.BN( now.unix() ),
            new anchor.BN(period),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolLedger.publicKey,
                    rand : randomPubkey,
                    saleMint : sale_mint,
                    saleAccount : saleAccount,
                    stakeMint : stake_mint,
                    stakeAccount : stakeAccount,
                    systemProgram :  anchor.web3.SystemProgram.programId,
                },
                signers: [owner]
            }
        )
        logger.log("    TX: program.rpc.initPool", tx)
    } catch(err) {
        logger.debug(err)
    }
    logger.debug("poolLedger.publicKey.toBase58()", poolLedger.publicKey.toBase58())
    return pool
}

export async function initStaker(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let [staker, bump] = await PublicKey.findProgramAddress(
        [pool.toBuffer(),owner.publicKey.toBuffer()],
        programId,
    )
    try{
        const tx = await program.rpc.initStaker(
            new anchor.BN(bump),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    staker : staker,
                    systemProgram :  anchor.web3.SystemProgram.programId,
                },
                signers:[owner]
            }
        )
        logger.log("    TX: program.rpc.initStaker", tx)
    } catch(err) {
        logger.debug(err)
    }
}

export async function stakeToken(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    stakeAccount : PublicKey,
    amount : number,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let [staker, bump] = await PublicKey.findProgramAddress([pool.toBuffer(),owner.publicKey.toBuffer()],programId)
    try{
        const tx = await program.rpc.stakeToken(
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    staker : staker,
                    sourceStakeAccount : stakeAccount,
                    destStakeAccount : poolData.stakeAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
        logger.log("    TX: program.rpc.stakeToken", tx)
    } catch(err) {
        logger.debug(err)
    }     
}

export async function unstakeToken(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    stakeAccount : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let [staker, bump] = await PublicKey.findProgramAddress([pool.toBuffer(),owner.publicKey.toBuffer()],programId)
    try{
        await program.rpc.unstakeToken(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    staker : staker,
                    sourceStakeAccount : poolData.stakeAccount,
                    destStakeAccount : stakeAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        logger.debug(err)
    }     
}

export async function deposit(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    saleAccount : PublicKey,
    amount : number,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let now = Math.floor((moment().unix() - poolData.startAt.toNumber()) / poolData.period.toNumber())
    try{
        await program.rpc.deposit(
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    sourceSaleAccount : saleAccount,
                    destSaleAccount : poolData.saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        logger.debug(err)
    }
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    return poolLedgerData.lastNumber.toNumber()       
}

export async function withdraw(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    saleAccount : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let [staker, bump] = await PublicKey.findProgramAddress([pool.toBuffer(),owner.publicKey.toBuffer()],programId)
    try{
        await program.rpc.withdraw(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    staker : staker,
                    sourceSaleAccount : poolData.saleAccount,
                    destSaleAccount : saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        logger.debug(err)
    }       
}

export async function getPoolData(
    conn : Connection,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    logger.debug("--- Pool Data ---")
    logger.debug("Pool owner : "+poolData.owner.toBase58())
    logger.debug("Sale token : " + poolData.saleMint.toBase58())
    logger.debug("Stake token : " + poolData.stakeMint.toBase58())
    logger.debug("Start at : " + poolData.startAt.toNumber())
    logger.debug("Period : " + poolData.period.toNumber())       
}

export async function getPoolLedgerData(
    conn : Connection,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    logger.debug("LastNo : "+poolLedgerData.lastNumber.toNumber())
    let last = poolLedgerData.lastNumber.toNumber()
    for(let i = 0 ; i< last + 2; i++){
        let ledger = poolLedgerData.ledger[i]
        if(i != last)
            logger.debug("No "+i+" : "+ledger.totalStakeToken.toNumber()+"(DDD token) and "+ledger.income.toNumber()+"(sol)")
        else
            logger.debug("No "+i+" : "+ledger.totalStakeToken.toNumber()+"(DDD token) and "+ledger.income.toNumber()+"(sol)  -----   Currect Time")
    }         
}

export async function getStakerData(
    conn : Connection,
    owner : PublicKey,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let [staker, bump] = await PublicKey.findProgramAddress([pool.toBuffer(),owner.toBuffer()],programId)
    let stakerData = await program.account.staker.fetch(staker)
    logger.debug(owner.toBase58()+ " staked " +stakerData.stakedAmount.toNumber()+" token at No "+stakerData.number.toNumber())
}

export async function getTokenBalance(
    conn : Connection,
    tokenAccount : PublicKey,
    ){
    let amount = (await conn.getTokenAccountBalance(tokenAccount)).value.uiAmount
    logger.debug(tokenAccount.toBase58() + " - " + amount)
}

export async function predictWithdrawableAmount(
    conn : Connection,
    owner : PublicKey,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    let [staker, bump] = await PublicKey.findProgramAddress([pool.toBuffer(),owner.toBuffer()],programId)
    let stakerData = await program.account.staker.fetch(staker)
    let amount = stakerData.stakedAmount.toNumber()
    if(amount == 0) return 0;
    let first = stakerData.withdrawNumber.toNumber()
    let last = Math.floor((moment().unix() - poolData.startAt.toNumber()) / poolData.period.toNumber())
    let total = 0
    for(let i = stakerData.number.toNumber() + 1 ; i <= last; i++){
        let ledger = poolLedgerData.ledger[i]
        if(ledger.totalStakeToken.toNumber()!=0)
            total += Math.ceil(ledger.income.toNumber() * amount / ledger.totalStakeToken.toNumber())
    }
    return total;
}