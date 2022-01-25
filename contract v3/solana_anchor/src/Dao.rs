pub mod utils;
use borsh::{BorshDeserialize,BorshSerialize};
use arrayref::{array_ref,array_refs};
use {
    crate::utils::*,
    anchor_lang::{
        prelude::*,
        AnchorDeserialize,
        AnchorSerialize,
        Discriminator,
        Key,
        solana_program::{
            program::invoke,
            program_pack::Pack,
            sysvar::{clock::Clock},
            msg
        }      
    },
    metaplex_token_metadata::{
        instruction::{create_metadata_accounts,create_master_edition},
    },
    spl_token::state,
};
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod solana_anchor {
    use super::*;

    pub fn init_pool(
        ctx : Context<InitPool>,
        _bump : u8,
        _start_at : i64,
        _period : u64,
        ) -> ProgramResult {
        msg!("Init Pool");
        let pool = &mut ctx.accounts.pool;
        let sale_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.sale_account.data.borrow())?;
        let stake_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.stake_account.data.borrow())?;
        if sale_account.owner != pool.key() {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if sale_account.mint != *ctx.accounts.sale_mint.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if stake_account.owner != pool.key() {
            return Err(PoolError::InvalidTokenAccount.into());
        } 
        if stake_account.mint != *ctx.accounts.stake_mint.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if _period == 0 {
            return Err(PoolError::InvalidPeriod.into());
        }

        pool.owner = *ctx.accounts.owner.key;
        pool.sale_mint = *ctx.accounts.sale_mint.key;
        pool.sale_account = *ctx.accounts.sale_account.key;
        pool.stake_mint = *ctx.accounts.stake_mint.key;
        pool.stake_account = *ctx.accounts.stake_account.key;
        pool.rand = *ctx.accounts.rand.key;
        pool.start_at = _start_at;
        pool.period = _period;
        pool.bump = _bump;
        pool.pool_ledger = ctx.accounts.pool_ledger.key();
        let pool_ledger_info = &mut ctx.accounts.pool_ledger;
        let mut new_data = PoolLedger::discriminator().try_to_vec().unwrap();
        new_data.append(&mut pool.key().try_to_vec().unwrap());
        new_data.append(&mut (0 as u64).try_to_vec().unwrap());
        new_data.append(&mut (0 as u64).try_to_vec().unwrap());
        let mut data = pool_ledger_info.data.borrow_mut();
        for i in 0..new_data.len() {
            data[i] = new_data[i];
        }
        let vec_start = 8 + 32 + 8 + 8;
        let as_bytes = (MAX_LEDGER_LEN as u32).to_le_bytes();
        for i in 0..4 {
            data[vec_start+i] = as_bytes[i];
        }

        Ok(())
    }

    pub fn stake_token(
        ctx : Context<StakeToken>,
        _bump : u8,
        _amount : u64
        ) -> ProgramResult {
        msg!("Stake Token");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let metadata_extended = &mut ctx.accounts.metadata_extended;
        if clock.unix_timestamp < pool.start_at {
            msg!("This pool is not started");
            return Err(PoolError::InvalidTime.into());
        }
        let number = (clock.unix_timestamp - pool.start_at) as u64 / pool.period ;
        if number as usize > MAX_LEDGER_LEN {
            msg!("This pool is already ended");
            return Err(PoolError::InvalidTime.into());
        }
        if pool.pool_ledger != *ctx.accounts.pool_ledger.key {
            msg!("Not match pool ledger account");
            return Err(PoolError::InvalidPoolLedger.into());
        }
        if pool.stake_account != *ctx.accounts.dest_stake_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        let pool_address = get_pool_address(&ctx.accounts.pool_ledger)?;
        if pool_address != pool.key() {
            return Err(PoolError::InvalidPoolLedger.into());
        }
        let nft_mint : state::Mint = state::Mint::unpack_from_slice(&ctx.accounts.nft_mint.data.borrow())?;
        if nft_mint.supply != 1 || nft_mint.decimals != 0 {
            msg!("Invalid nft");
            return Err(PoolError::InvalidTokenMint.into());
        }
        let num_nft = get_num_nft(&ctx.accounts.pool_ledger)?;
        let creators : Vec<metaplex_token_metadata::state::Creator> = 
            vec![metaplex_token_metadata::state::Creator{
                address: *ctx.accounts.owner.key,
                verified : true,
                share : 100,
            }];
        // creators.push(metaplex_token_metadata::state::Creator{
        //     address : *ctx.accounts.owner.key,
        //     verified : false,
        //     share : 100,
        // });

        spl_token_transfer_without_seed(
            TokenTransferParamsWithoutSeed{
                source : ctx.accounts.source_stake_account.clone(),
                destination : ctx.accounts.dest_stake_account.clone(),
                authority : ctx.accounts.owner.clone(),
                token_program : ctx.accounts.token_program.clone(),
                amount : _amount,
            }
        )?;

        invoke(
            &create_metadata_accounts(
                *ctx.accounts.token_metadata_program.key,
                *ctx.accounts.metadata.key,
                *ctx.accounts.nft_mint.key,
                *ctx.accounts.owner.key,
                *ctx.accounts.owner.key,
                *ctx.accounts.owner.key,
                String::from(format!("{}{}",NFT_NAME,num_nft)),
                String::from(NFT_SYMBOL),
                String::from(NFT_URI),
                Some(creators),
                0,
                true,
                true,
            ),
            &[
                ctx.accounts.metadata.clone(),
                ctx.accounts.nft_mint.clone(),
                ctx.accounts.owner.clone(),
                ctx.accounts.owner.clone(),
                ctx.accounts.owner.clone(),
                ctx.accounts.token_metadata_program.clone(),
                ctx.accounts.token_program.clone(),
                ctx.accounts.system_program.to_account_info().clone(),
                ctx.accounts.rent.to_account_info().clone(),
            ]
        )?;

        invoke(
            &create_master_edition(
                *ctx.accounts.token_metadata_program.key,
                *ctx.accounts.master_edition.key,
                *ctx.accounts.nft_mint.key,
                *ctx.accounts.owner.key,
                *ctx.accounts.owner.key,
                *ctx.accounts.metadata.key,
                *ctx.accounts.owner.key,
                None,
            ),
            &[
                ctx.accounts.master_edition.clone(),
                ctx.accounts.nft_mint.clone(),
                ctx.accounts.owner.clone(),
                ctx.accounts.owner.clone(),
                ctx.accounts.owner.clone(),
                ctx.accounts.metadata.clone(),
                ctx.accounts.token_program.clone(),
                ctx.accounts.system_program.to_account_info().clone(),
                ctx.accounts.rent.to_account_info().clone(),
            ]
        )?;        

        let last_number = get_last_number(&ctx.accounts.pool_ledger)?;
        msg!("cur number {}",number);
        msg!("last number {}",last_number);
        let last_ledger = get_daily_ledger(&ctx.accounts.pool_ledger,last_number as usize + 1)?;

        set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize + 1,DailyLedger{
            total_stake_token : last_ledger.total_stake_token + _amount,
            income : 0,
            changed : true
        });

        set_last_number(&mut ctx.accounts.pool_ledger,number);
        set_num_nft(&mut ctx.accounts.pool_ledger,num_nft + 1);
        metadata_extended.pool = pool.key();
        metadata_extended.values = _amount;
        metadata_extended.number = number;
        metadata_extended.withdraw_number = number+1;
        metadata_extended.bump = _bump;

        Ok(())
    }

    pub fn unstake_token(
        ctx : Context<UnstakeToken>,
        ) -> ProgramResult {
        msg!("Unstake Token");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let metadata_extended = &mut ctx.accounts.metadata_extended;

        if clock.unix_timestamp < pool.start_at {
            msg!("This pool is not started");
            return Err(PoolError::InvalidTime.into());
        }
        let number = (clock.unix_timestamp - pool.start_at) as u64 / pool.period ;
        // if number as usize >= MAX_LEDGER_LEN {
        //     msg!("This pool is already ended");
        //     return Err(PoolError::InvalidTime.into());
        // }
        if pool.pool_ledger != *ctx.accounts.pool_ledger.key {
            msg!("Not match pool ledger account");
            return Err(PoolError::InvalidPoolLedger.into());
        }
        if pool.stake_account != *ctx.accounts.source_stake_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        let pool_address = get_pool_address(&ctx.accounts.pool_ledger)?;
        if pool_address != pool.key() {
            return Err(PoolError::InvalidPoolLedger.into());
        }

        let nft_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.nft_account.data.borrow())?;
        let nft_mint : state::Mint = state::Mint::unpack_from_slice(&ctx.accounts.nft_mint.data.borrow())?;
        if nft_mint.supply != 1 || nft_mint.decimals != 0 {
            msg!("Invalid nft");
            return Err(PoolError::InvalidTokenMint.into());
        }
        if nft_account.mint != *ctx.accounts.nft_mint.key {
            msg!("Not match nft mint");
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if nft_account.amount != 1 {
            msg!("amount of nft account is invalid");
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if nft_account.owner != *ctx.accounts.owner.key {
            msg!("Not match nft owner");
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if metadata_extended.values == 0 {
            msg!("Values of this nft is zero now");
            return Err(PoolError::InvalidMetadataExtended.into());
        }
        if metadata_extended.pool != pool.key(){
            msg!("MetadataExtended pool is not matched");
            return Err(PoolError::InvalidMetadataExtended.into());
        }

        let pool_seeds = &[
            pool.rand.as_ref(),
            &[pool.bump],
        ];

        let _amount = metadata_extended.values;
        spl_token_transfer(
            TokenTransferParams{
                source : ctx.accounts.source_stake_account.clone(),
                destination : ctx.accounts.dest_stake_account.clone(),
                authority : pool.to_account_info().clone(),
                authority_signer_seeds : pool_seeds,
                token_program : ctx.accounts.token_program.clone(),
                amount : _amount,
            }
        )?;

        spl_token_burn(TokenBurnParams {
            mint : ctx.accounts.nft_mint.clone(),
            source : ctx.accounts.nft_account.clone(),
            amount : 1,
            authority : ctx.accounts.owner.clone(),
            authority_signer_seeds : &[],
            token_program : ctx.accounts.token_program.clone(),
        })?;

        if (number as usize) < (MAX_LEDGER_LEN-1) {
            let last_number = get_last_number(&ctx.accounts.pool_ledger)?;
            let last_ledger = get_daily_ledger(&ctx.accounts.pool_ledger,last_number as usize + 1)?;
              
            set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize + 1,DailyLedger{
                total_stake_token : last_ledger.total_stake_token - _amount,
                income : 0,
                changed : true
            });
        }
        set_last_number(&mut ctx.accounts.pool_ledger,number);

        metadata_extended.values = 0;

        Ok(())
    }

    pub fn deposit(
        ctx : Context<Deposit>,
        _amount : u64,
        ) -> ProgramResult {
        msg!("Deposit");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        if clock.unix_timestamp < pool.start_at {
            msg!("This pool is not started");
            return Err(PoolError::InvalidTime.into());
        }
        let number = (clock.unix_timestamp - pool.start_at) as u64 / pool.period ;
        if number as usize > MAX_LEDGER_LEN {
            msg!("This pool is already ended");
            return Err(PoolError::InvalidTime.into());
        }

        if pool.pool_ledger != *ctx.accounts.pool_ledger.key {
            msg!("Not match pool ledger account");
            return Err(PoolError::InvalidPoolLedger.into());
        }

        if pool.sale_account != *ctx.accounts.dest_sale_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        spl_token_transfer_without_seed(
            TokenTransferParamsWithoutSeed{
                source : ctx.accounts.source_sale_account.clone(),
                destination : ctx.accounts.dest_sale_account.clone(),
                authority : ctx.accounts.owner.clone(),
                token_program : ctx.accounts.token_program.clone(),
                amount : _amount,
            }
        )?;

        let pool_address = get_pool_address(&ctx.accounts.pool_ledger)?;
        if pool_address != pool.key() {
            return Err(PoolError::InvalidPoolLedger.into());
        }

        let last_number = get_last_number(&ctx.accounts.pool_ledger)?;
        let last_ledger = get_daily_ledger(&ctx.accounts.pool_ledger,last_number as usize + 1)?;
        let cur_ledger = get_daily_ledger(&ctx.accounts.pool_ledger,number as usize)?;

        if number == last_number {
            set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize,DailyLedger{
                total_stake_token : cur_ledger.total_stake_token,
                income : cur_ledger.income + _amount,
                changed : true,
            });
            if !last_ledger.changed {
                set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize + 1,DailyLedger{
                    total_stake_token : cur_ledger.total_stake_token,
                    income : 0,
                    changed : last_ledger.changed,
                });             
            }
        } else {
            set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize,DailyLedger{
                total_stake_token : last_ledger.total_stake_token,
                income : _amount,
                changed : true,
            }); 
            set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize + 1,DailyLedger{
                total_stake_token : last_ledger.total_stake_token,
                income : 0,
                changed : false,
            });
        }


        set_last_number(&mut ctx.accounts.pool_ledger,number);      
        Ok(())
    }

    pub fn withdraw(
        ctx : Context<Withdraw>,
        ) -> ProgramResult {
        msg!("Withdraw");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let metadata_extended = &mut ctx.accounts.metadata_extended;

        if clock.unix_timestamp < pool.start_at {
            msg!("This pool is not started");
            return Err(PoolError::InvalidTime.into());
        }
        let mut number = (clock.unix_timestamp - pool.start_at) as u64 / pool.period ;
        if number as usize > MAX_LEDGER_LEN {
            number = MAX_LEDGER_LEN as u64;
        }
        if pool.pool_ledger != *ctx.accounts.pool_ledger.key {
            msg!("Not match pool ledger account");
            return Err(PoolError::InvalidPoolLedger.into());
        }
        if pool.sale_account != *ctx.accounts.source_sale_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        let nft_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.nft_account.data.borrow())?;
        let nft_mint : state::Mint = state::Mint::unpack_from_slice(&ctx.accounts.nft_mint.data.borrow())?;
        if nft_mint.supply != 1 || nft_mint.decimals != 0 {
            msg!("Invalid nft");
            return Err(PoolError::InvalidTokenMint.into());
        }
        if nft_account.mint != *ctx.accounts.nft_mint.key {
            msg!("Not match nft mint");
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if nft_account.amount != 1 {
            msg!("amount of nft account is invalid");
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if nft_account.owner != *ctx.accounts.owner.key {
            msg!("Not match nft owner");
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if metadata_extended.values == 0 {
            msg!("Values of this nft is zero now");
            return Err(PoolError::InvalidMetadataExtended.into());
        }
        if metadata_extended.pool != pool.key(){
            msg!("MetadataExtended pool is not matched");
            return Err(PoolError::InvalidMetadataExtended.into());
        }

        let total = get_withdrawable_amount(&ctx.accounts.pool_ledger, metadata_extended.withdraw_number as usize, number as usize, metadata_extended.values)?;
        // let mut ledger;
        // for i in metadata_extended.withdraw_number..number{
        //     ledger = get_daily_ledger(&ctx.accounts.pool_ledger,i as usize)?;
        //     if ledger.income != 0 {
        //         total += ledger.income * metadata_extended.values / ledger.total_stake_token;
        //     }
        // }
        let pool_seeds = &[
            pool.rand.as_ref(),
            &[pool.bump],
        ];        
        spl_token_transfer(
            TokenTransferParams{
                source : ctx.accounts.source_sale_account.clone(),
                destination : ctx.accounts.dest_sale_account.clone(),
                authority : pool.to_account_info().clone(),
                authority_signer_seeds : pool_seeds,
                token_program : ctx.accounts.token_program.clone(),
                amount : total,
            }
        )?;
        metadata_extended.withdraw_number = number;
        Ok(())
    }

}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut, constraint = pool_ledger.to_account_info().owner == program_id && pool_ledger.to_account_info().data_len() >= POOL_LEDGER_SIZE )]
    pool_ledger : AccountInfo<'info>,

    #[account(owner=spl_token::id())]
    nft_mint : AccountInfo<'info>,

    #[account(owner=spl_token::id())]
    nft_account : AccountInfo<'info>,

    #[account(mut,seeds=[(*nft_mint.key).as_ref()], bump=metadata_extended.bump)]
    metadata_extended : ProgramAccount<'info,MetadataExtended>,

    #[account(mut,owner=spl_token::id())]
    source_sale_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_sale_account : AccountInfo<'info>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,
    
    clock : AccountInfo<'info>,          
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut, constraint = pool_ledger.to_account_info().owner == program_id && pool_ledger.to_account_info().data_len() >= POOL_LEDGER_SIZE )]
    pool_ledger : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    source_sale_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_sale_account : AccountInfo<'info>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,
    
    clock : AccountInfo<'info>,          
}

#[derive(Accounts)]
pub struct UnstakeToken<'info> {
    #[account(mut, signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut, constraint = pool_ledger.to_account_info().owner == program_id && pool_ledger.to_account_info().data_len() >= POOL_LEDGER_SIZE )]
    pool_ledger : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    nft_mint : AccountInfo<'info>,

    #[account(mut, owner=spl_token::id())]
    nft_account : AccountInfo<'info>,

    #[account(mut,seeds=[(*nft_mint.key).as_ref()], bump=metadata_extended.bump)]
    metadata_extended : ProgramAccount<'info,MetadataExtended>,

    #[account(mut,owner=spl_token::id())]
    source_stake_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_stake_account : AccountInfo<'info>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,
    
    clock : AccountInfo<'info>,     
}

#[derive(Accounts)]
#[instruction(_bump : u8)]
pub struct StakeToken<'info> {
    #[account(mut, signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut, constraint = pool_ledger.to_account_info().owner == program_id && pool_ledger.to_account_info().data_len() >= POOL_LEDGER_SIZE )]
    pool_ledger : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    source_stake_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_stake_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    nft_mint : AccountInfo<'info>,

    #[account(mut)]
    metadata : AccountInfo<'info>,

    #[account(mut)]
    master_edition : AccountInfo<'info>,

    #[account(init, seeds=[(*nft_mint.key).as_ref()], bump=_bump, payer=owner, space=8+METADATA_EXTENDED_SIZE)]
    metadata_extended : ProgramAccount<'info, MetadataExtended>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,
    
    #[account(address=metaplex_token_metadata::id())]
    token_metadata_program : AccountInfo<'info>,

    system_program : Program<'info,System>,

    rent : Sysvar<'info,Rent>,

    clock : AccountInfo<'info>,     
}

#[derive(Accounts)]
#[instruction(_bump : u8)]
pub struct InitPool<'info>{
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    #[account(init, seeds=[(*rand.key).as_ref()], bump=_bump, payer=owner, space=8+POOL_SIZE)]
    pool : ProgramAccount<'info, Pool>,

    #[account(mut, constraint = pool_ledger.to_account_info().owner == program_id && pool_ledger.to_account_info().data_len() >= POOL_LEDGER_SIZE )]
    pool_ledger : AccountInfo<'info>,

    rand : AccountInfo<'info>,    

    #[account(owner=spl_token::id())]
    sale_mint : AccountInfo<'info>,

    #[account(owner=spl_token::id())]
    sale_account : AccountInfo<'info>,

    #[account(owner=spl_token::id())]
    stake_mint : AccountInfo<'info>,

    #[account(owner=spl_token::id())]
    stake_account : AccountInfo<'info>,

    system_program : Program<'info,System>,
}

pub const POOL_SIZE : usize = 32 + 32 + 32 + 32 + 32 + 32 + 32 + 8  + 8 + 1;
pub const MAX_LEDGER_LEN : usize = 365 * 10;
pub const DAILY_LEDGER_SIZE : usize = 8 + 8 + 1;
pub const POOL_LEDGER_SIZE : usize = 8 + 32 + 8 + 8 + 4 + (DAILY_LEDGER_SIZE * MAX_LEDGER_LEN);
pub const METADATA_EXTENDED_SIZE : usize = 32 + 8 + 8 + 8 + 1;
pub const PREFIX : &str = "Ledger";
pub const NFT_NAME : &str = "SKATED TOKEN #";
pub const NFT_URI : &str = "https://arweave.net/s0N0oOU4H09PKwEUnRbF4oUxwI9f8DFciY6LZ-JPH0E";
pub const NFT_SYMBOL : &str = "Gorilla";

#[account]
pub struct Pool{
    pub owner : Pubkey,
    pub sale_mint : Pubkey,
    pub sale_account : Pubkey,
    pub stake_mint : Pubkey,
    pub stake_account : Pubkey,
    pub pool_ledger : Pubkey,
    pub rand : Pubkey,
    pub start_at : i64,
    pub period : u64,
    pub bump : u8,
}

#[account]
#[derive(Default)]
pub struct PoolLedger{
    pub pool : Pubkey,
    pub last_number : u64,
    pub nft_number : u64,
    pub ledger : Vec<DailyLedger>
}

#[derive(AnchorSerialize,AnchorDeserialize,Clone,Copy)]
pub struct DailyLedger{
    pub total_stake_token : u64,
    pub income : u64,
    pub changed : bool,
}

pub const ARRAY_START : usize = 8 + 32 + 8 + 8 + 4;

pub fn set_daily_ledger(
    a: &mut AccountInfo,
    index : usize,
    daily_ledger : DailyLedger,
    ){
    let mut arr = a.data.borrow_mut();
    let data_array = daily_ledger.try_to_vec().unwrap();
    let vec_start = ARRAY_START+DAILY_LEDGER_SIZE*index;
    for i in 0..data_array.len() {
        arr[vec_start+i] = data_array[i];
    }
}

pub fn set_last_number(
    a: &mut AccountInfo,
    last_number : u64,
    ){
    let mut arr = a.data.borrow_mut();
    let data_array = last_number.try_to_vec().unwrap();
    let vec_start = 40;
    for i in 0..data_array.len() {
        arr[vec_start+i] = data_array[i];
    }    
}

pub fn set_num_nft(
    a: &mut AccountInfo,
    num_nft : u64,
    ){
    let mut arr = a.data.borrow_mut();
    let data_array = num_nft.try_to_vec().unwrap();
    let vec_start = 48;
    for i in 0..data_array.len() {
        arr[vec_start+i] = data_array[i];
    }    
}

pub fn get_pool_address(
    a : &AccountInfo,
    ) -> core::result::Result<Pubkey,ProgramError> {
    let arr = a.data.borrow();
    let data_array = &arr[8..40];
    let pool : Pubkey = Pubkey::try_from_slice(data_array)?;
    Ok(pool)
}

pub fn get_last_number(
    a : &AccountInfo,
    ) -> core::result::Result<u64,ProgramError> {
    let arr = a.data.borrow();
    let data_array = &arr[40..48];
    let last_number : u64 = u64::try_from_slice(data_array)?;
    Ok(last_number)
}

pub fn get_num_nft(
    a : &AccountInfo,
    ) -> core::result::Result<u64,ProgramError> {
    let arr = a.data.borrow();
    let data_array = &arr[48..56];
    let num_nft : u64 = u64::try_from_slice(data_array)?;
    Ok(num_nft)
}

pub fn get_daily_ledger(
    a: &AccountInfo,
    index : usize,
    ) -> core::result::Result<DailyLedger,ProgramError> {
    let arr = a.data.borrow();
    let data_array = &arr[ARRAY_START+DAILY_LEDGER_SIZE*index..ARRAY_START+DAILY_LEDGER_SIZE*(index+1)];
    let daily_ledger : DailyLedger = DailyLedger::try_from_slice(data_array)?;
    Ok(daily_ledger)
}

pub fn get_withdrawable_amount(
    a: &AccountInfo,
    first : usize,
    last : usize,
    amount : u64,
    ) -> core::result::Result<u64,ProgramError> {
    let arr = a.data.borrow();
    let mut total : u64 = 0;
    let mut index_start = ARRAY_START+DAILY_LEDGER_SIZE*first;
    for _i in first..last {
        let src = array_ref![arr,index_start,DAILY_LEDGER_SIZE];
        let (total_stake_token, income, changed) = array_refs![src, 8, 8, 1];
        let total_stake_token = u64::from_le_bytes(*total_stake_token);
        let income = u64::from_le_bytes(*income);
        let changed = match changed {
            [0] => false,
            [1] => true,
            _ => true,
        };
        index_start += DAILY_LEDGER_SIZE;
        if changed {
            total += income * amount / total_stake_token;
        }
    }
    Ok(total)
}

#[account]
pub struct MetadataExtended{
    pub pool : Pubkey,
    pub values : u64,
    pub number : u64,
    pub withdraw_number : u64,
    pub bump : u8,
}

#[error]
pub enum PoolError {
    #[msg("Token mint to failed")]
    TokenMintToFailed,

    #[msg("Token set authority failed")]
    TokenSetAuthorityFailed,

    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("Token burn failed")]
    TokenBurnFailed,

    #[msg("Invalid token account")]
    InvalidTokenAccount,

    #[msg("Invalid time")]
    InvalidTime,

    #[msg("Invalid pool ledger")]
    InvalidPoolLedger,

    #[msg("Invalid period")]
    InvalidPeriod,

    #[msg("Invalid metadata extended account")]
    InvalidMetadataExtended,

    #[msg("Invalid token mint")]
    InvalidTokenMint,
}