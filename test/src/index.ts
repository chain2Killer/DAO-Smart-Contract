import * as pool_api from './pool_api'
import * as logger from './logger'

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
  LAMPORTS_PER_SOL,
  SystemProgram,
  clusterApiUrl
} from "@solana/web3.js"
import * as bs58 from 'bs58'
import * as splToken from '@solana/spl-token'
import fs from 'fs'
import * as anchor from '@project-serum/anchor'
import moment from 'moment'

const sleep = (ms : number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const n_allInvolvedUsers = 4; // 20
const n_firstStakers = 2; // 15
const n_secondStakers = 2;
const n_unstakers = 2;

const saveUsersForTheFuture = true;

function loadBidders() : any[] {
  const rawdata = fs.readFileSync('bidders.json');
  const bidders = JSON.parse(rawdata.toString())
  if(bidders.length < n_allInvolvedUsers) {
    throw 'Not enough bidder data in the json file'
  }
  logger.log("Loaded bidders from json");
  const realBidders : any[] = loadBidders();
  for(let b of bidders) {
    logger.log(b)
    realBidders.push(
      {

      })

  }

  return realBidders;
}

async function scenario() {
/*******   Constructing environment   *******/
  logger.debug("+ Constructing Environment...")
  const conn = new Connection("https://api.devnet.solana.com")
  let payerKeypair = Keypair.fromSecretKey(bs58.decode("2pUVo4mVSnebLyLmMTHgPRNbk7rgZki77bsYgbsuuQX9585N4aKNXWJRpyc98qnpgRKRH2hzB8VVnqeffurW39F4"))
  const payer = payerKeypair.publicKey

  const sale_mint = new PublicKey("5Pdw82Xqs6kzSZf2p472LbKb4FqegtQkgoaXCnE4URfa")
  const saleMint = new splToken.Token(conn,sale_mint,splToken.TOKEN_PROGRAM_ID,payerKeypair)
  const payerSaleToken = new PublicKey("FrucchR8uxjXDssYh6f2Av5r1wEnp9E65mjTTmTGijBS")

  const ddd_mint = new PublicKey("FwSgEjN1okgGomujPCLAbS8S3JjpWMGahKEnHoBfjZ5G")
  const dddMint = new splToken.Token(conn,ddd_mint,splToken.TOKEN_PROGRAM_ID,payerKeypair)
  // const payerDDDToken = await dddMint.createAccount(payer)
  // await dddMint.mintTo(payerDDDToken,payerKeypair,[],200)
  // const saleMint = await splToken.Token.createMint(conn, payerKeypair, payer, null, 3, splToken.TOKEN_PROGRAM_ID)
  // const payerSaleToken = await saleMint.createAccount(payer)
  // await saleMint.mintTo(payerSaleToken, payerKeypair, [], 1000000)
  // const dddMint = await splToken.Token.createMint(conn, payerKeypair, payer, null, 0, splToken.TOKEN_PROGRAM_ID)

  // logger.debug('Created saleMint', saleMint.publicKey.toBase58(), ' and minted for the payer ', payerKeypair.publicKey.toBase58())
  // logger.debug('Created DDD token mint', dddMint.publicKey.toBase58())

  // logger.debug("1. Init Pool")
  // const pool = await pool_api.initPool(conn,payerKeypair,saleMint.publicKey,dddMint.publicKey,1000,30)
  // logger.debug(pool.toBase58())
  // await pool_api.getPoolData(conn,pool)

  // logger.debug("2. Init Staker")
  // await pool_api.initStaker(conn,payerKeypair,pool)
  // await pool_api.getStakerData(conn,payer,pool)

  // logger.debug("3. Stake")
  // await pool_api.stakeToken(conn,payerKeypair,pool,payerDDDToken,200)
  // await pool_api.getStakerData(conn,payer,pool)
  // await pool_api.getPoolLedgerData(conn,pool)

  // logger.debug("4. Deposit")
  // await pool_api.deposit(conn,payerKeypair,pool,payerSaleToken,20000)
  // await pool_api.getPoolLedgerData(conn,pool)
  // logger.debug(await pool_api.predictWithdrawableAmount(conn,payer,pool))

  // logger.debug("5. Unstake")
  // await pool_api.unstakeToken(conn,payerKeypair,pool,payerDDDToken)
  // await pool_api.getStakerData(conn,payer,pool)




  const bidders : any[] = []; // loadBidders();
  for(let i = 0; i < n_allInvolvedUsers ; i++) {
    const bidder = Keypair.generate()
    let transaction = new Transaction()
    transaction.add(SystemProgram.transfer({
      fromPubkey : payerKeypair.publicKey,
      toPubkey : bidder.publicKey,
      lamports : LAMPORTS_PER_SOL / 10,
    }))
    // logger.debug("Transfering sol that will be used for gas to account", bidder.publicKey.toBase58())
    await sendAndConfirmTransaction(conn, transaction, [payerKeypair])
    
    // logger.debug("Creating stake and sale token accounts for", bidder.publicKey.toBase58())
    const dddAccount = await dddMint.createAccount(bidder.publicKey)
    const saleAccount = await saleMint.createAccount(bidder.publicKey)
    // logger.debug("Minting stake and sale tokens  for", bidder.publicKey.toBase58())
    await dddMint.mintTo(dddAccount, payerKeypair, [], 200)
    await saleMint.mintTo(saleAccount, payerKeypair, [], 100000)
    logger.debug("Person " + (i + 1) + " : " + bidder.publicKey.toBase58() + " ---> 200 DDD and 100 sol")
    bidders.push({bidderKeypair : bidder, publicKey : bidder.publicKey, dddAccount : dddAccount, saleAccount : saleAccount})  
  }

  if(saveUsersForTheFuture) {
    const fileName = 'bidders' + moment().format('MMMMDoYYYYThh:mm:ss') + '.json';
    fs.writeFileSync(fileName, JSON.stringify(bidders))
    logger.log("Saved the bidder users to ", fileName)
  }

  logger.debug("1. Init Pool")
  const pool = await pool_api.initPool(conn,payerKeypair,saleMint.publicKey,dddMint.publicKey,30)
  await pool_api.getPoolData(conn,pool)
  logger.debug("pool.toBase58()", pool.toBase58())  

  for(let i = 0; i < n_allInvolvedUsers; i++ ) {
    let bidder = bidders[i]
    await pool_api.initStaker(conn,bidder.bidderKeypair,pool)
  }
  logger.debug("")

  logger.debug("2. " + n_firstStakers, "+ bidders stake their DDD token")
  let first = n_firstStakers;
  for(let i = 0; i < first; i++) {
    let bidder = bidders[i]
    let amountToStake = 20 + 3 * i;
    if(amountToStake > 50) amountToStake = 50;
    await pool_api.stakeToken(conn,bidder.bidderKeypair, pool, bidder.dddAccount, amountToStake)
    await pool_api.getStakerData(conn,bidder.publicKey,pool)
  }
  await pool_api.getPoolLedgerData(conn,pool)
  logger.debug("")

  logger.debug("3. Send 200 sol to the Pool Bank")
  let now = await pool_api.deposit(conn,payerKeypair,pool, payerSaleToken, 200000)
  logger.debug("deposited at No "+now)
  await pool_api.getPoolLedgerData(conn,pool)

  logger.debug(" #########  Checking account earnings")
  for(let bidder of bidders) {
    let total = await pool_api.predictWithdrawableAmount(conn, bidder.publicKey, pool)
    logger.debug(bidder.publicKey.toBase58() + " : " + total)
  }

  logger.debug("4. "+n_secondStakers, "+ other bidders stake their DDD token")
  for(let i = 0; i < n_secondStakers ; i++) {
    let bidder = bidders[first + i]
    let amountToStake = 20 + 3 * i;
    if(amountToStake > 50) amountToStake = 50;
    await pool_api.stakeToken(conn, bidder.bidderKeypair, pool, bidder.dddAccount, amountToStake)
    await pool_api.getStakerData(conn,bidder.publicKey,pool)
  }
  await pool_api.getPoolLedgerData(conn,pool)
  logger.debug("")

  logger.debug("5. Add 100 sol to Pool Bank")
  now = await pool_api.deposit(conn, payerKeypair, pool, payerSaleToken, 100000)
  logger.debug("deposited at No "+now)
  await pool_api.getPoolLedgerData(conn,pool)

  logger.debug(" #########  Checking account earnings")
  for(let bidder of bidders) {
    let total = await pool_api.predictWithdrawableAmount(conn, bidder.publicKey, pool)
    logger.debug(bidder.publicKey.toBase58() + " : " + total)
  }

  logger.debug("6. "+n_unstakers, "-  bidders unstake their DDD token")
  for(let i = 0; i < n_unstakers; i++) {
    let bidder = bidders[i]
    await pool_api.unstakeToken(conn, bidder.bidderKeypair, pool, bidder.dddAccount)
  }
  await pool_api.getPoolLedgerData(conn,pool)
}

scenario()