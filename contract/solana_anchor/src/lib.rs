pub mod utils;
use borsh::{BorshDeserialize,BorshSerialize};
use {
    crate::utils::*,
    anchor_lang::{
        prelude::*,
        AnchorDeserialize,
        AnchorSerialize,
        Discriminator,
        Key,
        solana_program::{
            program_pack::Pack,
            sysvar::{clock::Clock},
            msg
        }      
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
        let mut data = pool_ledger_info.data.borrow_mut();
        for i in 0..new_data.len() {
            data[i] = new_data[i];
        }
        let vec_start = 8 + 32 + 8;
        let as_bytes = (MAX_LEDGER_LEN as u32).to_le_bytes();
        for i in 0..4 {
            data[vec_start+i] = as_bytes[i];
        }

        Ok(())
    }

    pub fn init_staker(
        ctx : Context<InitStaker>,
        _bump : u8,
        ) -> ProgramResult {
        msg!("Init Staker");
        let staker = &mut ctx.accounts.staker;
        staker.owner = *ctx.accounts.owner.key;
        staker.pool = ctx.accounts.pool.key();
        staker.staked_amount = 0;
        staker.number = 0;
        staker.withdraw_number = 1;
        staker.bump = _bump;
        Ok(())
    }

    pub fn stake_token(
        ctx : Context<StakeToken>,
        _amount : u64,
        ) -> ProgramResult {
        msg!("Stake Token");
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
        if pool.stake_account != *ctx.accounts.dest_stake_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        let staker = &mut ctx.accounts.staker;
        spl_token_transfer_without_seed(
            TokenTransferParamsWithoutSeed{
                source : ctx.accounts.source_stake_account.clone(),
                destination : ctx.accounts.dest_stake_account.clone(),
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
        if number != last_number {
            for i in last_number + 2..number + 2 {
                set_daily_ledger(&mut ctx.accounts.pool_ledger,i as usize,DailyLedger{
                    total_stake_token : last_ledger.total_stake_token,
                    income : 0
                });
            }
        }

        set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize + 1,DailyLedger{
            total_stake_token : last_ledger.total_stake_token + _amount,
            income : last_ledger.income
        });

        set_last_number(&mut ctx.accounts.pool_ledger,number);

        staker.staked_amount = _amount;
        staker.number = number;
        Ok(())
    }

    pub fn unstake_token(
        ctx : Context<StakeToken>,
        ) -> ProgramResult {
        msg!("Unstake Token");
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
        if pool.stake_account != *ctx.accounts.source_stake_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        let staker = &mut ctx.accounts.staker;
        let _amount = staker.staked_amount;

        let pool_seeds = &[
            pool.rand.as_ref(),
            &[pool.bump],
        ];

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

        let pool_address = get_pool_address(&ctx.accounts.pool_ledger)?;
        if pool_address != pool.key() {
            return Err(PoolError::InvalidPoolLedger.into());
        }

        let last_number = get_last_number(&ctx.accounts.pool_ledger)?;
        let last_ledger = get_daily_ledger(&ctx.accounts.pool_ledger,last_number as usize + 1)?;
        if number != last_number {
            for i in last_number + 2..number + 2 {
                set_daily_ledger(&mut ctx.accounts.pool_ledger,i as usize,DailyLedger{
                    total_stake_token : last_ledger.total_stake_token,
                    income : 0
                });
            }
        }

        set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize + 1,DailyLedger{
            total_stake_token : last_ledger.total_stake_token - _amount,
            income : last_ledger.income
        });

        set_last_number(&mut ctx.accounts.pool_ledger,number);

        staker.staked_amount = 0;
        staker.number = number;
        staker.withdraw_number = number+1;        
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
        if number != last_number {
            for i in last_number + 2..number + 2 {
                set_daily_ledger(&mut ctx.accounts.pool_ledger,i as usize,DailyLedger{
                    total_stake_token : last_ledger.total_stake_token,
                    income : 0
                });
            }
        }
        let cur_ledger = get_daily_ledger(&ctx.accounts.pool_ledger,number as usize)?;
        set_daily_ledger(&mut ctx.accounts.pool_ledger,number as usize,DailyLedger{
            total_stake_token : cur_ledger.total_stake_token,
            income : cur_ledger.income + _amount
        });

        set_last_number(&mut ctx.accounts.pool_ledger,number);      
        Ok(())
    }

    pub fn withdraw(
        ctx : Context<Withdraw>,
        ) -> ProgramResult {
        msg!("Withdraw");
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
        if pool.sale_account != *ctx.accounts.source_sale_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        let staker = &mut ctx.accounts.staker;
        if staker.staked_amount == 0 {
            msg!("You don't have any stake token");
            return Err(PoolError::InvalidStakerData.into());
        }     

        let mut total = 0;
        for i in staker.withdraw_number..number{
            let ledger = get_daily_ledger(&ctx.accounts.pool_ledger,i as usize)?;
            if ledger.total_stake_token != 0 && ledger.income != 0 {
                total += ledger.income * staker.staked_amount / ledger.total_stake_token;
            }
        }
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
        staker.withdraw_number = number;
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

    #[account(mut,has_one=owner,seeds=[pool.key().as_ref(), (*owner.key).as_ref()], bump=staker.bump)]
    staker : ProgramAccount<'info,Staker>,

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
pub struct StakeToken<'info> {
    #[account(mut, signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut, constraint = pool_ledger.to_account_info().owner == program_id && pool_ledger.to_account_info().data_len() >= POOL_LEDGER_SIZE )]
    pool_ledger : AccountInfo<'info>,

    #[account(mut,has_one=owner,seeds=[pool.key().as_ref(), (*owner.key).as_ref()], bump=staker.bump)]
    staker : ProgramAccount<'info,Staker>,

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
pub struct InitStaker<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(init, seeds=[pool.key().as_ref(),(*owner.key).as_ref()], bump=_bump, payer=owner, space=8+STAKER_SIZE)]
    staker : ProgramAccount<'info,Staker>,

    system_program : Program<'info,System>,
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
pub const DAILY_LEDGER_SIZE : usize = 8 + 8;
pub const POOL_LEDGER_SIZE : usize = 8 + 32 + 8 + 4 + (DAILY_LEDGER_SIZE * MAX_LEDGER_LEN);
pub const STAKER_SIZE : usize = 32 + 32 + 8 + 8 + 8 + 1;

/*
    Pool account has constant properties of our pool such as you can see following structure.
    In solana clock, unit of time is second. From this reason, unit of period is second(not ms or not minute)
    You can set one day as period ( if Pool.period = 60 * 60 * 24)
    Similar to this, we can consider start_at property.
*/
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

/*
    PoolLedger account has transaction(stake, unstake, deposit, withdraw...) logs of our pool.
    last_number represents time last transaction runs
    ledger has information about how many stake token and income there are in pool at each time.
*/
#[account]
#[derive(Default)]
pub struct PoolLedger{
    pub pool : Pubkey,
    pub last_number : u64,
    pub ledger : Vec<DailyLedger>
}

#[derive(AnchorSerialize,AnchorDeserialize,Clone)]
pub struct DailyLedger{
    pub total_stake_token : u64,
    pub income : u64,
}

pub const ARRAY_START : usize = 8 + 32 + 8 + 4;

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

pub fn get_daily_ledger(
    a: &AccountInfo,
    index : usize,
    ) -> core::result::Result<DailyLedger,ProgramError> {
    let arr = a.data.borrow();
    let data_array = &arr[ARRAY_START+DAILY_LEDGER_SIZE*index..ARRAY_START+DAILY_LEDGER_SIZE*(index+1)];
    let daily_ledger : DailyLedger = DailyLedger::try_from_slice(data_array)?;
    Ok(daily_ledger)
}

/*
    Staker account has user info of pool. This account is PDA.
    number property represents when you stake token.
    withdraw_number represents time when you withdraw for the last time.
*/

#[account]
pub struct Staker{
    pub owner : Pubkey,
    pub pool : Pubkey,
    pub staked_amount : u64,
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

    #[msg("Invalid token account")]
    InvalidTokenAccount,

    #[msg("Invalid time")]
    InvalidTime,

    #[msg("Invalid pool ledger")]
    InvalidPoolLedger,

    #[msg("Invalid period")]
    InvalidPeriod,

    #[msg("Invalid staker data")]
    InvalidStakerData,
}