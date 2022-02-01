import * as pool_api from './pool_api'
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

const n_allInvolvedUsers = 3; // 20
const n_firstStakers = 2; // 15
const n_secondStakers = 1;
const n_unstakers = 2;
const endpoint = 120;

async function scenario1() {
/*******   Constructing environment   *******/
  console.log("+ Constructing Environment")
  const conn = new Connection("https://api.devnet.solana.com")
  console.log(await conn.getMinimumBalanceForRentExemption(58400))
  // const payerKeypair = pool_api.loadWalletKey("./src/id.json")
  let payerKeypair = Keypair.fromSecretKey(bs58.decode("2pUVo4mVSnebLyLmMTHgPRNbk7rgZki77bsYgbsuuQX9585N4aKNXWJRpyc98qnpgRKRH2hzB8VVnqeffurW39F4"))
  const payer = payerKeypair.publicKey

  const sale_mint = new PublicKey("5Pdw82Xqs6kzSZf2p472LbKb4FqegtQkgoaXCnE4URfa")
  const saleMint = new splToken.Token(conn,sale_mint,splToken.TOKEN_PROGRAM_ID,payerKeypair)
  const payerSaleToken = new PublicKey("FrucchR8uxjXDssYh6f2Av5r1wEnp9E65mjTTmTGijBS")

  const ddd_mint = new PublicKey("FwSgEjN1okgGomujPCLAbS8S3JjpWMGahKEnHoBfjZ5G")
  const dddMint = new splToken.Token(conn,ddd_mint,splToken.TOKEN_PROGRAM_ID,payerKeypair)

  // const saleMint = await splToken.Token.createMint(conn, payerKeypair, payer, null, 3, splToken.TOKEN_PROGRAM_ID)
  // const payerSaleToken = await saleMint.createAccount(payer)
  // await saleMint.mintTo(payerSaleToken, payerKeypair, [], 1000000)
  // const dddMint = await splToken.Token.createMint(conn, payerKeypair, payer, null, 0, splToken.TOKEN_PROGRAM_ID)

  console.log('Created saleMint', saleMint.publicKey.toBase58(), ' and minted for the payer ', payerKeypair.publicKey.toBase58())
  console.log('Created DDD token mint', dddMint.publicKey.toBase58())

  const bidders : any[] = []
  for(let i = 0; i < n_allInvolvedUsers ; i++) {
    const bidder = Keypair.generate()
    let transaction = new Transaction()
    transaction.add(SystemProgram.transfer({
      fromPubkey : payerKeypair.publicKey,
      toPubkey : bidder.publicKey,
      lamports : LAMPORTS_PER_SOL/10,
    }))
    await sendAndConfirmTransaction(conn,transaction,[payerKeypair])
    
    const dddAccount = await dddMint.createAccount(bidder.publicKey)
    const saleAccount = await saleMint.createAccount(bidder.publicKey)
    await dddMint.mintTo(dddAccount, payerKeypair, [], 200)
    await saleMint.mintTo(saleAccount, payerKeypair, [], 100000)
    console.log("Person "+ (i+1) + " : " + bidder.publicKey.toBase58() + " ---> 200 DDD and 100 sol")
    bidders.push({bidderKeypair : bidder, publicKey : bidder.publicKey, dddAccount : dddAccount, saleAccount : saleAccount})  
  }

/********  Init Pool *********/
  console.log("+ Init Pool")
  const pool = await pool_api.initPool(conn, payerKeypair, saleMint.publicKey, dddMint.publicKey, 1000, 0, 300,endpoint)
  console.log(pool.toBase58())  
  for(let i = 0; i < n_allInvolvedUsers; i++ ) {
    let bidder = bidders[i]
    await pool_api.initStaker(conn,bidder.bidderKeypair,pool)
  }
  console.log("")

  console.log("+ Send 200 sol to the Pool Bank")
  while(!(await pool_api.input(conn,payerKeypair,pool, payerSaleToken, 200000))){
    await sleep(endpoint)
  }
  console.log("You sent")

  // if((await pool_api.input(conn,payerKeypair,pool, payerSaleToken, 200000)))
  //   console.log("You sent")
  // else
  //   console.log("Now is endpoint")

// /********  Stake DDD *********/
  console.log(n_firstStakers, "+ bidders stake their DDD token")
  let first = n_firstStakers;
  for(let i = 0; i < first; i++) {
    let bidder = bidders[i]
    let amountToStake = 20 + 3 * i;
    if(amountToStake > 50) amountToStake = 50;
    while(!(await pool_api.stake(conn,bidder.bidderKeypair, pool, bidder.dddAccount, amountToStake)))
      await sleep(endpoint)
    console.log("Person " + i + " : staked", amountToStake)
  }
  console.log("")

/******* Send 200sol to Pool Bank ********/
  console.log("+ Send 200 sol to the Pool Bank")
  while(!(await pool_api.input(conn,payerKeypair,pool, payerSaleToken, 200000)))
    await sleep(endpoint)
  console.log("You sent")

  await pool_api.getPoolLedger(conn,pool)

  for(let i =0; i < n_firstStakers; i++)
    await pool_api.getStakerLedger(conn,bidders[i].publicKey,pool)
/////// Check all bidders live earning
  console.log(" #########  Checking account earnings")
  for(let bidder of bidders) {
    let total = await pool_api.getPoolEarningForAccount(conn, bidder.publicKey, pool)
    console.log(bidder.publicKey.toBase58() + " : " + total)
  }

/******* Stake DDD *******/
  console.log(n_secondStakers, "+ other bidders stake their DDD token")
  for(let i = 0; i < n_secondStakers ; i++) {
    let bidder = bidders[first + i]
    let amountToStake = 20 + 3 * i;
    if(amountToStake > 50) amountToStake = 50;
    while(!(await pool_api.stake(conn, bidder.bidderKeypair, pool, bidder.dddAccount, amountToStake)))
      await sleep(endpoint)
    console.log("Person " + (i + first) + " : staked", amountToStake)
  }
  await pool_api.getPoolLedger(conn, pool)

/******* Add sol to Pool Bank ********/
  console.log("+ Add 100 sol to Pool Bank")
  while(!(await pool_api.input(conn, payerKeypair, pool, payerSaleToken, 100000)))
    await sleep(endpoint)
  console.log("You sent")

///// Check all bidders live earning
  console.log(" #########  Checking account earnings")
  for(let bidder of bidders) {
    let total = await pool_api.getPoolEarningForAccount(conn, bidder.publicKey, pool)
    console.log(bidder.publicKey.toBase58() + " : " + total)
  }

/******* Unstake n_unstakers addresses ********/
  console.log(n_unstakers, "-  bidders unstake their DDD token")
  for(let i = 0; i < n_unstakers; i++) {
    let bidder = bidders[i]
    await pool_api.unstake(conn, bidder.bidderKeypair, pool, bidder.dddAccount, 10)
  }
  await pool_api.getPoolLedger(conn, pool)

  for(let i =0; i < n_allInvolvedUsers; i++)
    await pool_api.getStakerLedger(conn,bidders[i].publicKey,pool)

/************** End ***************/
  console.log("+ End")
}

scenario1()