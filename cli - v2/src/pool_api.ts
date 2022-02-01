
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
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY
} from "@solana/web3.js";
import * as splToken from '@solana/spl-token'
import fs from 'fs'
import * as anchor from '@project-serum/anchor'
import moment from 'moment'

const confirmOption : ConfirmOptions = {
    commitment : 'finalized',
    preflightCommitment : 'finalized',
    skipPreflight : false
}

const sleep = (ms : number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export let programId = new PublicKey('GWCgAqU6ztmpereqHFaJSBBjsiDxMMNqGJGZQZKn8Bzs')
const idl=JSON.parse(fs.readFileSync('src/solana_anchor.json','utf8'))
const STAKER_LEDGER_SIZE = 8+ 32+32+40
const POOL_LEDGER_SIZE = 8 +32+40


export async function initPool(
    conn : Connection,
    owner : Keypair,
    sale_mint : PublicKey,
    stake_mint : PublicKey,
    mint_price : number,
    start_at : number,
    duration : number,
    endpoint : number,
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
    try{
        await program.rpc.initPool(
            new anchor.BN(bump),
            new anchor.BN(mint_price),
            new anchor.BN(start_at),
            new anchor.BN(duration),
            new anchor.BN(endpoint),
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
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers: [owner,poolLedger]
            }
        )
    } catch(err) {
        console.log(err)
    }
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
    let stakerLedger = Keypair.generate()
    try{
        await program.rpc.initStaker(
            new anchor.BN(bump),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    staker : staker,
                    stakerLedger : stakerLedger.publicKey,
                    systemProgram :  anchor.web3.SystemProgram.programId,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner,stakerLedger]
            }
        )
    } catch(err) {
        console.log(err)
    }
}

export async function stake(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    stakeAccount : PublicKey,
    amount : number
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let [staker, bump] = await PublicKey.findProgramAddress([pool.toBuffer(),owner.publicKey.toBuffer()],programId)
    let stakerData = await program.account.staker.fetch(staker)
    let poolLedger = await program.account.poolLedger.fetch(poolData.lastLedger)
    let stakerLedger = await program.account.stakerLedger.fetch(stakerData.lastLedger)

    const now = moment().unix()
    const number = Math.floor((now - poolData.startAt.toNumber()) / poolData.duration.toNumber())
    if(now - poolData.startAt.toNumber() + poolData.endpoint.toNumber() > (number + 1) * poolData.duration.toNumber())
        return false;

    let tx = new Transaction()
    let sg : Keypair[] = [owner]

    let poolLastLedger = poolData.lastLedger
    let stakerLastLedger = stakerData.lastLedger

    let isNew = false

    if(poolLedger.number.toNumber() != number){
        // await createPoolLedger(conn,owner,pool)
        let newPoolLedger = Keypair.generate()
        sg.push(newPoolLedger)
        tx.add(program.instruction.createPoolLedger({
            accounts:{
                owner : owner.publicKey,
                pool : pool,
                lastPoolLedger : poolLastLedger,
                newPoolLedger : newPoolLedger.publicKey,
                systemProgram :  anchor.web3.SystemProgram.programId,
                clock : SYSVAR_CLOCK_PUBKEY,
            }
        }))
        poolLastLedger = newPoolLedger.publicKey
        isNew = true
    }

    if(stakerLedger.number.toNumber() != number){
        // await createStakerLedger(conn,owner,pool)
        let newStakerLedger = Keypair.generate()
        sg.push(newStakerLedger)
        tx.add(program.instruction.createStakerLedger({
            accounts:{
                owner : owner.publicKey,
                pool : pool,
                staker : staker,
                lastStakerLedger : stakerLastLedger,
                newStakerLedger : newStakerLedger.publicKey,
                systemProgram :  anchor.web3.SystemProgram.programId,
                clock : SYSVAR_CLOCK_PUBKEY,
            }
        }))
        stakerLastLedger = newStakerLedger.publicKey
        isNew = true
    }  
    if(isNew)   await sendAndConfirmTransaction(conn,tx,sg,confirmOption)
    // await depositStakeToken(conn,owner,pool,stakeAccount,amount)
    await program.rpc.depositStakeToken(new anchor.BN(amount),{
        accounts:{
            owner : owner.publicKey,
            pool : pool,
            lastPoolLedger : poolLastLedger,
            staker : staker,
            lastStakerLedger : stakerLastLedger,
            sourceStakeAccount : stakeAccount,
            destStakeAccount : poolData.stakeAccount,
            tokenProgram : splToken.TOKEN_PROGRAM_ID,
            clock : SYSVAR_CLOCK_PUBKEY,            
        },
        signers : [owner]
    })
    // await sendAndConfirmTransaction(conn,tx,sg)
    return true;

}

export async function unstake(
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
    let stakerData = await program.account.staker.fetch(staker)
    let poolLedger = await program.account.poolLedger.fetch(poolData.lastLedger)
    let stakerLedger = await program.account.stakerLedger.fetch(stakerData.lastLedger)

    const now = moment().unix()
    const number = Math.floor((now - poolData.startAt.toNumber()) / poolData.duration.toNumber())
    if(now - poolData.startAt.toNumber() + poolData.endpoint.toNumber() > (number + 1) * poolData.duration.toNumber())
        return false;

    let tx = new Transaction()
    let sg : Keypair[] = [owner]

    let poolLastLedger = poolData.lastLedger
    let stakerLastLedger = stakerData.lastLedger

    let isNew = false

    if(poolLedger.number.toNumber() != number){
        // await createPoolLedger(conn,owner,pool)
        let newPoolLedger = Keypair.generate()
        sg.push(newPoolLedger)
        tx.add(program.instruction.createPoolLedger({
            accounts:{
                owner : owner.publicKey,
                pool : pool,
                lastPoolLedger : poolLastLedger,
                newPoolLedger : newPoolLedger.publicKey,
                systemProgram :  anchor.web3.SystemProgram.programId,
                clock : SYSVAR_CLOCK_PUBKEY,
            }
        }))
        poolLastLedger = newPoolLedger.publicKey
        isNew =true
    }

    if(stakerLedger.number.toNumber() != number){
        // await createStakerLedger(conn,owner,pool)
        let newStakerLedger = Keypair.generate()
        sg.push(newStakerLedger)
        tx.add(program.instruction.createStakerLedger({
            accounts:{
                owner : owner.publicKey,
                pool : pool,
                staker : staker,
                lastStakerLedger : stakerLastLedger,
                newStakerLedger : newStakerLedger.publicKey,
                systemProgram :  anchor.web3.SystemProgram.programId,
                clock : SYSVAR_CLOCK_PUBKEY,
            }
        }))
        stakerLastLedger = newStakerLedger.publicKey
        isNew = true
    }
    if(isNew) await sendAndConfirmTransaction(conn,tx,sg,confirmOption)
    // await withdrawStakeToken(conn,owner,pool,stakeAccount,amount)
    await program.rpc.withdrawStakeToken(new anchor.BN(amount),{
        accounts:{
            owner : owner.publicKey,
            pool : pool,
            lastPoolLedger : poolLastLedger,
            staker : staker,
            lastStakerLedger : stakerLastLedger,
            sourceStakeAccount : poolData.stakeAccount,
            destStakeAccount : stakeAccount,
            tokenProgram : splToken.TOKEN_PROGRAM_ID,
            clock : SYSVAR_CLOCK_PUBKEY,            
        },
        signers : [owner]
    })

    return true
}

export async function input(
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
    let poolLedger = await program.account.poolLedger.fetch(poolData.lastLedger)
    
    const now = moment().unix()
    const number = Math.floor((now - poolData.startAt.toNumber()) / poolData.duration.toNumber())
    if(now - poolData.startAt.toNumber() + poolData.endpoint.toNumber() > (number + 1) * poolData.duration.toNumber())
        return false;

    let tx = new Transaction()
    let sg : Keypair[] = [owner]

    let poolLastLedger = poolData.lastLedger

    if(poolLedger.number.toNumber() != number){
        // await createPoolLedger(conn,owner,pool)
        let newPoolLedger = Keypair.generate()
        sg.push(newPoolLedger)
        tx.add(program.instruction.createPoolLedger({
            accounts:{
                owner : owner.publicKey,
                pool : pool,
                lastPoolLedger : poolLastLedger,
                newPoolLedger : newPoolLedger.publicKey,
                systemProgram :  anchor.web3.SystemProgram.programId,
                clock : SYSVAR_CLOCK_PUBKEY,
            }
        }))
        poolLastLedger = newPoolLedger.publicKey
        await sendAndConfirmTransaction(conn,tx,sg,confirmOption)
    }
    // await depositIncome(conn,owner,pool,saleAccount,amount)
    await program.rpc.depositIncome(new anchor.BN(amount),{
        accounts:{
            owner : owner.publicKey,
            pool : pool,
            lastPoolLedger : poolLastLedger,
            sourceSaleAccount : saleAccount,
            destSaleAccount : poolData.saleAccount,
            tokenProgram : splToken.TOKEN_PROGRAM_ID,
            clock : SYSVAR_CLOCK_PUBKEY,
        },
        signers : [owner]        
    })

    return true    
}

export async function output(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    poolLedger : PublicKey,
    saleAccount : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)

    let poolLedgerData = await program.account.poolLedger.fetch(poolLedger)
    const resp = await conn.getProgramAccounts(programId,{
        dataSlice: { length: 0, offset: 0 },
        filters: [
            { dataSize: STAKER_LEDGER_SIZE }, 
            { memcmp: { offset: 8, bytes: owner.publicKey.toBase58() } },
            { memcmp: { offset: 40, bytes: pool.toBase58() } },
        ]        
    })
    let stakerLedger : any = null
    for(let ledger of resp){
        const ledgerData = await program.account.stakerLedger.fetch(ledger.pubkey)
        if(ledgerData.number.toNumber() <= poolLedgerData.number.toNumber() && ledgerData.nextNumber.toNumber() > poolLedgerData.number.toNumber())
            stakerLedger = ledger.pubkey
    }
    if(stakerLedger == null) return;
    let [withdrawnCheck,bump] = await PublicKey.findProgramAddress([poolLedger.toBuffer(), owner.publicKey.toBuffer()],programId)
    if((await conn.getAccountInfo(withdrawnCheck)) == null){
        await initWithdrawnCheck(conn,owner,poolLedger)
    } else{
        const withdrawnCheckData = await program.account.withdrawnCheck.fetch(withdrawnCheck)
        if(!withdrawnCheckData.withdrawn)
            await withdrawIncome(conn,owner,pool,poolLedger,stakerLedger,saleAccount)        
    }
}

export async function createStakerLedger(
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
    let stakerData = await program.account.staker.fetch(staker)
    let newStakerLedger = Keypair.generate()
    try{
        await program.rpc.createStakerLedger(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    staker : staker,
                    lastStakerLedger : stakerData.lastLedger,
                    newStakerLedger : newStakerLedger.publicKey,
                    systemProgram :  anchor.web3.SystemProgram.programId,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner,newStakerLedger]
            }
        )
    } catch(err) {
        console.log(err)
    } 
}

export async function createPoolLedger(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let newPoolLedger = Keypair.generate()
    try{
        await program.rpc.createPoolLedger(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    lastPoolLedger : poolData.lastLedger,
                    newPoolLedger : newPoolLedger.publicKey,
                    systemProgram :  anchor.web3.SystemProgram.programId,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner,newPoolLedger]
            }
        )
    } catch(err) {
        console.log(err)
    }
}

export async function depositStakeToken(
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
    let [staker, bump] = await PublicKey.findProgramAddress(
        [pool.toBuffer(),owner.publicKey.toBuffer()],
        programId,
    )
    let stakerData = await program.account.staker.fetch(staker)
    try{
        await program.rpc.depositStakeToken(
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    lastPoolLedger : poolData.lastLedger,
                    staker : staker,
                    lastStakerLedger : stakerData.lastLedger,
                    sourceStakeAccount : stakeAccount,
                    destStakeAccount : poolData.stakeAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        console.log(err)
    }     
}

export async function withdrawStakeToken(
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
    let [staker, bump] = await PublicKey.findProgramAddress(
        [pool.toBuffer(),owner.publicKey.toBuffer()],
        programId,
    )
    let stakerData = await program.account.staker.fetch(staker)
    try{
        await program.rpc.withdrawStakeToken(
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    lastPoolLedger : poolData.lastLedger,
                    staker : staker,
                    lastStakerLedger : stakerData.lastLedger,
                    sourceStakeAccount : poolData.stakeAccount,
                    destStakeAccount : stakeAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        console.log(err)
    }     
}

export async function initWithdrawnCheck(
    conn : Connection,
    owner : Keypair,
    poolLedger : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let [withdrawnCheck,bump] = await PublicKey.findProgramAddress(
        [poolLedger.toBuffer(), owner.publicKey.toBuffer()],
        programId
    )
    try{
        await program.rpc.initWithdrawnCheck(
            new anchor.BN(bump),
            {
                accounts:{
                    owner : owner.publicKey,
                    lastPoolLedger : poolLedger,
                    withdrawnCheck : withdrawnCheck,
                    systemProgram : anchor.web3.SystemProgram.programId,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        console.log(err)
    } 
}

export async function depositIncome(
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
    try{
        await program.rpc.depositIncome(
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    lastPoolLedger : poolData.lastLedger,
                    sourceSaleAccount : saleAccount,
                    destSaleAccount : poolData.saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        console.log(err)
    }         
}

export async function withdrawIncome(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    poolLedger : PublicKey,
    stakerLedger : PublicKey,
    saleAccount : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let [withdrawnCheck,bump] = await PublicKey.findProgramAddress(
        [poolLedger.toBuffer(), owner.publicKey.toBuffer()],
        programId
    )
    let poolData = await program.account.pool.fetch(pool)
    try{
        await program.rpc.withdrawIncome(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolLedger,
                    stakerLedger : stakerLedger,
                    withdrawnCheck : withdrawnCheck,
                    sourceSaleAccount : poolData.saleAccount,
                    destSaleAccount : saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        console.log(err)
    }       
}

export async function mintNft(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    saleAccount : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let [staker, bump] = await PublicKey.findProgramAddress(
        [pool.toBuffer(),owner.publicKey.toBuffer()],
        programId,
    )
    let stakerData = await program.account.staker.fetch(staker)
    let nftMint = await splToken.Token.createMint(conn,owner,owner.publicKey,null,0,splToken.TOKEN_PROGRAM_ID)
    let nftAccount = await nftMint.createAccount(owner.publicKey)
    try{
        await program.rpc.mintNft(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    lastPoolLedger : poolData.lastLedger,
                    staker : staker,
                    lastStakerLedger : stakerData.lastLedger,
                    nftMint : nftMint.publicKey,
                    nftAccount : nftAccount,
                    sourceSaleAccount : saleAccount,
                    destSaleAccount : poolData.saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        console.log(err)
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
    console.log("--- Pool Data ---")
    console.log("owner : "+poolData.owner.toBase58())
    console.log("Sale token : " + poolData.saleMint.toBase58())
    console.log("Stake token : " + poolData.stakeMint.toBase58())
    console.log("Mint price : " + poolData.mintPrice.toNumber())
    console.log("Start at : " + poolData.startAt.toNumber())
    console.log("Duration : " + poolData.duration.toNumber())        
}

export async function getPoolLedger(
    conn : Connection,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    const respPool = await conn.getProgramAccounts(programId,{
        dataSlice: { length: 0, offset: 0 },
        filters: [
            { dataSize: POOL_LEDGER_SIZE }, 
            { memcmp: { offset: 8, bytes: pool.toBase58() } },
        ]        
    })
    let poolLedger : any[] = []    
    for(let temp of respPool)
        poolLedger.push(await program.account.poolLedger.fetch(temp.pubkey))

    poolLedger.sort(function(a,b){return a.number.toNumber() - b.number.toNumber()})
    console.log("--- Pool Ledger ---")
    poolLedger.map((item)=>{
        console.log("No : " + item.number.toNumber())
        console.log("income : "+item.income.toNumber())
        console.log("staked amount : "+item.stakedAmount.toNumber())
        console.log("num of nft : "+item.numberNft.toNumber())
        console.log("")
    })
}

export async function getStakerLedger(
    conn : Connection,
    owner : PublicKey,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    const respStaker = await conn.getProgramAccounts(programId,{
        dataSlice: { length: 0, offset: 0 },
        filters: [
            { dataSize: STAKER_LEDGER_SIZE }, 
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
            { memcmp: { offset: 40, bytes: pool.toBase58() } },
        ]        
    })
    let stakerLedger : any[] = []
    for(let temp of respStaker)
        stakerLedger.push(await program.account.stakerLedger.fetch(temp.pubkey))
    stakerLedger.sort(function(a,b){return a.number.toNumber() - b.number.toNumber()})
    console.log("--- Staker Ledger of " + owner.toBase58() + " ---")
    stakerLedger.map((item)=>{
        console.log("No : " + item.number.toNumber())
        console.log("staked amount : "+item.stakedAmount.toNumber())
        console.log("num of nft : " + item.numberNft.toNumber())
        console.log("")
    })
}

export async function getTokenBalance(
    conn : Connection,
    tokenAccount : PublicKey,
    ){
    let amount = (await conn.getTokenAccountBalance(tokenAccount)).value.uiAmount
    console.log(tokenAccount.toBase58() + " - " + amount);
}

export async function getPoolEarningForAccount(
    conn : Connection,
    owner : PublicKey,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)

    const respPool = await conn.getProgramAccounts(programId,{
        dataSlice: { length: 0, offset: 0 },
        filters: [
            { dataSize: POOL_LEDGER_SIZE }, 
            { memcmp: { offset: 8, bytes: pool.toBase58() } },
        ]        
    })

    const respStaker = await conn.getProgramAccounts(programId,{
        dataSlice: { length: 0, offset: 0 },
        filters: [
            { dataSize: STAKER_LEDGER_SIZE }, 
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
            { memcmp: { offset: 40, bytes: pool.toBase58() } },
        ]        
    })
    let poolLedger : any[] = []
    let stakerLedger : any[] = []
    for(let temp of respPool)
        poolLedger.push(await program.account.poolLedger.fetch(temp.pubkey))
    for(let temp of respStaker)
        stakerLedger.push(await program.account.stakerLedger.fetch(temp.pubkey))
    let total = 0
    for(let i in respPool){
        let [withdrawnCheck,bump] = await PublicKey.findProgramAddress([respPool[i].pubkey.toBuffer(), owner.toBuffer()],programId)
        let withdrawable = true;
        if((await conn.getAccountInfo(withdrawnCheck)) != null){
            const withdrawnCheckData = await program.account.withdrawnCheck.fetch(withdrawnCheck)
            if(withdrawnCheckData.withdrawn){
                withdrawable = false;
            }
        }
        if(withdrawable){
            for(let j in stakerLedger){
                if(poolLedger[i].number.toNumber() >= stakerLedger[j].number.toNumber() && (stakerLedger[j].number.toNumber()==stakerLedger[j].nextNumber.toNumber() || poolLedger[i].number.toNumber() < stakerLedger[j].nextNumber.toNumber())){
                    
                    let stakedAmount = stakerLedger[j].stakedAmount.toNumber()
                    if(poolLedger[i].number.toNumber() != stakerLedger[j].number.toNumber()){
                        stakedAmount -= stakerLedger[j].unstakedAmount.toNumber()
                    }
                    if(poolLedger[i].stakedAmount.toNumber() || poolLedger[i].numberNft.toNumber())
                    total += Math.floor(poolLedger[i].income.toNumber() * (stakedAmount + 10 * stakerLedger[j].numberNft.toNumber()) / (poolLedger[i].stakedAmount.toNumber() + 10 * poolLedger[i].numberNft.toNumber()))
                }
            }
        }
    }
    return total
}
