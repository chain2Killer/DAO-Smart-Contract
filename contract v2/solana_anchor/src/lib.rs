pub mod utils;
use borsh::{BorshDeserialize,BorshSerialize};
use {
    crate::utils::*,
    anchor_lang::{
        prelude::*,
        AnchorDeserialize,
        AnchorSerialize,
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
        _mint_price : u64,
        _start_at : i64,
        _duration : i64,
        _endpoint : i64,
        ) -> ProgramResult {
        msg!("Init Pool");
        let sale_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.sale_account.data.borrow())?;
        let stake_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.stake_account.data.borrow())?;
        if sale_account.owner != ctx.accounts.pool.key() {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if sale_account.mint != *ctx.accounts.sale_mint.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if stake_account.owner != ctx.accounts.pool.key() {
            return Err(PoolError::InvalidTokenAccount.into());
        } 
        if stake_account.mint != *ctx.accounts.stake_mint.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if _duration == 0 {
            return Err(PoolError::InvalidDuration.into());
        }
        if _endpoint > _duration {
            return Err(PoolError::InvalidEndpoint.into());
        }

        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &mut ctx.accounts.pool;
        pool.owner = *ctx.accounts.owner.key;
        pool.sale_mint = *ctx.accounts.sale_mint.key;
        pool.sale_account = *ctx.accounts.sale_account.key;
        pool.stake_mint = *ctx.accounts.stake_mint.key;
        pool.stake_account = *ctx.accounts.stake_account.key;
        pool.rand = *ctx.accounts.rand.key;
        pool.mint_price = _mint_price;
        pool.start_at = _start_at;
        pool.duration = _duration;
        pool.endpoint = _endpoint;
        pool.bump = _bump;
        pool.last_ledger = ctx.accounts.pool_ledger.key();
        let pool_ledger = &mut ctx.accounts.pool_ledger;
        pool_ledger.pool = pool.key();
        pool_ledger.income = 0;
        pool_ledger.staked_amount = 0;
        pool_ledger.unstaked_amount = 0;
        pool_ledger.number = (clock.unix_timestamp - _start_at) / _duration;
        pool_ledger.number_nft = 0;
        Ok(())
    }

    pub fn init_staker(
        ctx : Context<InitStaker>,
        _bump : u8,
        ) -> ProgramResult {
        msg!("Init Staker");
        let pool = &ctx.accounts.pool;
        let staker = &mut ctx.accounts.staker;
        staker.owner = *ctx.accounts.owner.key;
        staker.pool = ctx.accounts.pool.key();
        staker.last_ledger = ctx.accounts.staker_ledger.key();
        staker.bump = _bump;
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        let staker_ledger = &mut ctx.accounts.staker_ledger;
        staker_ledger.owner = *ctx.accounts.owner.key;
        staker_ledger.pool = ctx.accounts.pool.key();
        staker_ledger.staked_amount = 0;
        staker_ledger.number = number;
        staker_ledger.next_number = number;
        staker_ledger.number_nft = 0;
        Ok(())
    }

    pub fn create_pool_ledger(
        ctx : Context<CreatePoolLedger>,
        ) -> ProgramResult {
        msg!("Create Pool Ledger");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &mut ctx.accounts.pool;
        if pool.last_ledger != ctx.accounts.last_pool_ledger.key() {
            msg!("Last pool ledger is invalid");
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        // if (clock.unix_timestamp - pool.start_at) + pool.endpoint > pool.duration*(number + 1) {
        //     msg!("You are on endpoint now.");
        //     return Err(PoolError::InvalidClock.into());
        // }
        let last_pool_ledger = &ctx.accounts.last_pool_ledger;
        if last_pool_ledger.number == number {
            msg!("Time is invalid");
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }

        let new_pool_ledger = &mut ctx.accounts.new_pool_ledger;
        new_pool_ledger.pool = pool.key();
        new_pool_ledger.number = number;
        new_pool_ledger.income = 0;
        new_pool_ledger.staked_amount = last_pool_ledger.staked_amount - last_pool_ledger.unstaked_amount;
        new_pool_ledger.unstaked_amount = 0;
        new_pool_ledger.number_nft = last_pool_ledger.number_nft;
        pool.last_ledger = new_pool_ledger.key();

        Ok(())
    }

    pub fn create_staker_ledger(
        ctx : Context<CreateStakerLedger>,
        ) -> ProgramResult {
        msg!("Create StaKer Ledger");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        // if pool.last_ledger != ctx.accounts.last_pool_ledger.key() {
        //     return Err(PoolError::InvalidPoolLedgerAccount.into());
        // }
        if clock.unix_timestamp < pool.start_at {
            return Err(PoolError::InvalidClock.into());
        }
        
        let staker = &mut ctx.accounts.staker;
        if staker.last_ledger != ctx.accounts.last_staker_ledger .key() {
            msg!("Last staker ledger is invalid");
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }

        let last_staker_ledger = &mut ctx.accounts.last_staker_ledger;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        // if (clock.unix_timestamp - pool.start_at) + pool.endpoint > pool.duration*(number + 1) {
        //     msg!("You are on endpoint now.");
        //     return Err(PoolError::InvalidClock.into());
        // }        
        if last_staker_ledger.number == number{
            msg!("Time is invalid");
            return Err(PoolError::InvalidStakerLedgerAccount.into())
        }

        let new_staker_ledger = &mut ctx.accounts.new_staker_ledger;
        new_staker_ledger.owner = *ctx.accounts.owner.key;
        new_staker_ledger.pool = ctx.accounts.pool.key();
        new_staker_ledger.number = number;
        new_staker_ledger.next_number = number;
        new_staker_ledger.staked_amount = last_staker_ledger.staked_amount - last_staker_ledger.unstaked_amount;
        new_staker_ledger.unstaked_amount = 0;
        new_staker_ledger.number_nft = last_staker_ledger.number_nft;
        staker.last_ledger = new_staker_ledger.key();
        last_staker_ledger.next_number = number;
        Ok(())
    }

    pub fn deposit_stake_token(
        ctx : Context<DepositStakeToken>,
        _amount : u64
        ) -> ProgramResult {
        msg!("Deposit Stake token");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        // if (clock.unix_timestamp - pool.start_at) + pool.endpoint > pool.duration*(number + 1) {
        //     msg!("You are on endpoint now.");
        //     return Err(PoolError::InvalidClock.into());
        // }

        if pool.last_ledger != ctx.accounts.last_pool_ledger.key() {
            msg!("Invalid pool last ledger");
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }
        let last_pool_ledger = &mut ctx.accounts.last_pool_ledger;
        if last_pool_ledger.number != number {
            msg!("Invalid pool ledger number");
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }

        let staker = &ctx.accounts.staker;
        if staker.last_ledger != ctx.accounts.last_staker_ledger.key() {
            msg!("Invalid staker last ledger");
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }
        let last_staker_ledger = &mut ctx.accounts.last_staker_ledger;
        if last_staker_ledger.number != number {
            msg!("Invalid staker ledger number");
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }

        if pool.stake_account != *ctx.accounts.dest_stake_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }

        spl_token_transfer_without_seed(
            TokenTransferParamsWithoutSeed{
                source : ctx.accounts.source_stake_account.clone(),
                destination : ctx.accounts.dest_stake_account.clone(),
                authority : ctx.accounts.owner.clone(),
                token_program : ctx.accounts.token_program.clone(),
                amount : _amount,
            }
        )?;

        last_pool_ledger.staked_amount = last_pool_ledger.staked_amount + _amount;
        last_staker_ledger.staked_amount = last_staker_ledger.staked_amount + _amount;

        Ok(())
    }

    pub fn deposit_income(
        ctx : Context<DepositIncome>,
        _amount : u64
        ) -> ProgramResult {
        msg!("Deposit Income");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;

        if pool.last_ledger != ctx.accounts.last_pool_ledger.key() {
            msg!("Invalid pool last ledger");
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }
        let last_pool_ledger = &mut ctx.accounts.last_pool_ledger;
        if last_pool_ledger.number != number {
            msg!("Invalid pool ledger number");
            return Err(PoolError::InvalidPoolLedgerAccount.into());
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

        last_pool_ledger.income = last_pool_ledger.income + _amount;

        Ok(())
    }

    pub fn init_withdrawn_check(
        ctx : Context<InitWithdrawnCheck>,
        _bump : u8,
        ) -> ProgramResult {
        msg!("Init Withdrawn Check");
        let withdrawn_check = &mut ctx.accounts.withdrawn_check;
        withdrawn_check.bump = _bump;
        withdrawn_check.withdrawn = false;
        withdrawn_check.amount = 0;
        withdrawn_check.owner = *ctx.accounts.owner.key;
        Ok(())
    }

    pub fn withdraw_income(
        ctx : Context<WithdrawIncome>,
        ) -> ProgramResult {
        msg!("Withdraw Income");
        let pool_ledger = &ctx.accounts.pool_ledger;
        let staker_ledger = &ctx.accounts.staker_ledger;
        let pool = &ctx.accounts.pool;
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        if pool_ledger.number >= number{
            return Err(PoolError::InvalidWithdrawTime.into());
        }
        if pool_ledger.number < staker_ledger.number {
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }
        if pool_ledger.number >= staker_ledger.next_number || 
            staker_ledger.number == staker_ledger.next_number{
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }
        if pool_ledger.pool != ctx.accounts.pool.key() {
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }
        let withdrawn_check = &mut ctx.accounts.withdrawn_check;
        if withdrawn_check.withdrawn {
            return Err(PoolError::AlreadyWithdraw.into());
        }
        if pool.sale_account != *ctx.accounts.source_sale_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }
        if pool.sale_account == *ctx.accounts.dest_sale_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }

        let pool_seeds = &[
            pool.rand.as_ref(),
            &[pool.bump],
        ];

        let mut staked_amount = staker_ledger.staked_amount;
        if pool_ledger.number != staker_ledger.number {
            staked_amount = staked_amount - staker_ledger.unstaked_amount;
        }
        let amount = pool_ledger.income 
            * (staked_amount + 10 * staker_ledger.number_nft) 
            / (pool_ledger.staked_amount + 10 * pool_ledger.number_nft);

        spl_token_transfer(
            TokenTransferParams{
                source : ctx.accounts.source_sale_account.clone(),
                destination : ctx.accounts.dest_sale_account.clone(),
                authority : pool.to_account_info().clone(),
                authority_signer_seeds : pool_seeds,
                token_program : ctx.accounts.token_program.clone(),
                amount : amount,
            }
        )?;
        withdrawn_check.withdrawn = true;
        withdrawn_check.amount = amount;
        Ok(())
    }

    pub fn withdraw_stake_token(
        ctx : Context<WithdrawStakeToken>,
        _amount : u64,
        ) -> ProgramResult {
        msg!("Withdraw Stake Token");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        // if (clock.unix_timestamp - pool.start_at) + pool.endpoint > pool.duration*(number + 1) {
        //     msg!("You are on endpoint now.");
        //     return Err(PoolError::InvalidClock.into());
        // }
        if pool.last_ledger != ctx.accounts.last_pool_ledger.key() {
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }
        let last_pool_ledger = &mut ctx.accounts.last_pool_ledger;
        if last_pool_ledger.number != number {
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }

        let staker = &ctx.accounts.staker;
        if staker.last_ledger != ctx.accounts.last_staker_ledger.key() {
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }
        let last_staker_ledger = &mut ctx.accounts.last_staker_ledger;
        if last_staker_ledger.number != number {
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }
        if last_staker_ledger.staked_amount < last_staker_ledger.unstaked_amount + _amount {
            return Err(PoolError::InvalidAmount.into());
        }

        if pool.stake_account != *ctx.accounts.source_stake_account.key {
            return Err(PoolError::InvalidTokenAccount.into());
        }

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

        last_pool_ledger.unstaked_amount = last_pool_ledger.unstaked_amount + _amount;
        last_staker_ledger.unstaked_amount = last_staker_ledger.unstaked_amount + _amount;

        Ok(())
    }

    pub fn mint_nft(
        ctx : Context<MintNft>
        ) -> ProgramResult {
        msg!("Mint NFT");
        let clock = Clock::from_account_info(&ctx.accounts.clock)?;
        let pool = &ctx.accounts.pool;
        let number = (clock.unix_timestamp - pool.start_at) / pool.duration;
        if (clock.unix_timestamp - pool.start_at) + pool.endpoint > pool.duration*(number + 1) {
            msg!("You are on endpoint now.");
            return Err(PoolError::InvalidClock.into());
        }
        if pool.last_ledger != ctx.accounts.last_pool_ledger.key() {
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }
        let last_pool_ledger = &mut ctx.accounts.last_pool_ledger;
        if last_pool_ledger.number != number {
            return Err(PoolError::InvalidPoolLedgerAccount.into());
        }

        let staker = &ctx.accounts.staker;
        if staker.last_ledger != ctx.accounts.last_staker_ledger.key() {
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }
        let last_staker_ledger = &mut ctx.accounts.last_staker_ledger;
        if last_staker_ledger.number != number {
            return Err(PoolError::InvalidStakerLedgerAccount.into());
        }

        let _nft_mint : state::Mint = state::Mint::unpack_from_slice(&ctx.accounts.nft_mint.data.borrow())?;
        let _nft_account : state::Account = state::Account::unpack_from_slice(&ctx.accounts.nft_account.data.borrow())?;
        if _nft_mint.decimals != 0 {
            return Err(PoolError::InvalidMintAccount.into());
        }
        if _nft_mint.supply != 0 {
            return Err(PoolError::InvalidMintAccount.into());
        }
        if _nft_account.mint != *ctx.accounts.nft_mint.key {
            return Err(PoolError::InvalidTokenAccount.into());
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
                amount : pool.mint_price,
            }
        )?;

        spl_token_mint_to(
            TokenMintToParams{
                mint : ctx.accounts.nft_mint.clone(),
                account : ctx.accounts.nft_account.clone(),
                owner : ctx.accounts.owner.clone(),
                token_program : ctx.accounts.token_program.clone(),
                amount : 1 as u64,
            }
        )?;        

        last_pool_ledger.income = last_pool_ledger.income + pool.mint_price;
        last_staker_ledger.number_nft = last_staker_ledger.number_nft + 1;
        last_pool_ledger.number_nft = last_pool_ledger.number_nft + 1;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct MintNft<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut)]
    last_pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(has_one=owner,seeds=[pool.key().as_ref(), (*owner.key).as_ref()], bump=staker.bump)]
    staker : ProgramAccount<'info,Staker>,

    #[account(mut)]
    last_staker_ledger : ProgramAccount<'info, StakerLedger>,

    #[account(mut,owner=spl_token::id())]
    nft_mint : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    nft_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    source_sale_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_sale_account : AccountInfo<'info>,    

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,

    clock : AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WithdrawStakeToken<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut)]
    last_pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(has_one=owner,seeds=[pool.key().as_ref(), (*owner.key).as_ref()], bump=staker.bump)]
    staker : ProgramAccount<'info,Staker>,

    #[account(mut)]
    last_staker_ledger : ProgramAccount<'info, StakerLedger>,

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
pub struct InitWithdrawnCheck<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(init,seeds=[pool_ledger.key().as_ref(), (*owner.key).as_ref()], bump=_bump, payer=owner, space=8+WITHDRAWN_CHECK_SIZE)]
    withdrawn_check : ProgramAccount<'info, WithdrawnCheck>,    

    system_program : Program<'info,System>,
}

#[derive(Accounts)]
pub struct WithdrawIncome<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info, Pool>,

    pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(has_one=owner)]
    staker_ledger : ProgramAccount<'info, StakerLedger>,

    #[account(mut,seeds=[pool_ledger.key().as_ref(), (*owner.key).as_ref()], bump=withdrawn_check.bump)]
    withdrawn_check : ProgramAccount<'info, WithdrawnCheck>,

    #[account(mut,owner=spl_token::id())]
    source_sale_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_sale_account : AccountInfo<'info>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,

    clock : AccountInfo<'info>,         
}

#[derive(Accounts)]
pub struct DepositIncome<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut)]
    last_pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(mut,owner=spl_token::id())]
    source_sale_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_sale_account : AccountInfo<'info>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,
    
    clock : AccountInfo<'info>,         
}

#[derive(Accounts)]
pub struct DepositStakeToken<'info> {
    #[account(mut, signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut)]
    last_pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(has_one=owner,seeds=[pool.key().as_ref(), (*owner.key).as_ref()], bump=staker.bump)]
    staker : ProgramAccount<'info,Staker>,

    #[account(mut)]
    last_staker_ledger : ProgramAccount<'info, StakerLedger>,

    #[account(mut,owner=spl_token::id())]
    source_stake_account : AccountInfo<'info>,

    #[account(mut,owner=spl_token::id())]
    dest_stake_account : AccountInfo<'info>,

    #[account(address=spl_token::id())]
    token_program : AccountInfo<'info>,
    
    clock : AccountInfo<'info>,     
}

#[derive(Accounts)]
pub struct CreatePoolLedger<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    #[account(mut)]
    pool : ProgramAccount<'info, Pool>,

    last_pool_ledger : ProgramAccount<'info, PoolLedger>,

    #[account(init, payer=owner, space=8+POOL_LEDGER_SIZE)]
    new_pool_ledger : ProgramAccount<'info, PoolLedger>,

    system_program : Program<'info,System>,

    clock : AccountInfo<'info>,    
}

#[derive(Accounts)]
pub struct CreateStakerLedger<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    pool : ProgramAccount<'info,Pool>,

    #[account(mut,has_one=owner,seeds=[pool.key().as_ref(), (*owner.key).as_ref()], bump=staker.bump)]
    staker : ProgramAccount<'info,Staker>,

    #[account(mut)]
    last_staker_ledger : ProgramAccount<'info,StakerLedger>,

    #[account(init, payer=owner, space=8+STAKER_LEDGER_SIZE)]
    new_staker_ledger : ProgramAccount<'info,StakerLedger>,

    system_program : Program<'info,System>,

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

    #[account(init, payer=owner, space=8+STAKER_LEDGER_SIZE)]
    staker_ledger : ProgramAccount<'info,StakerLedger>,

    system_program : Program<'info,System>,

    clock : AccountInfo<'info>, 
}

#[derive(Accounts)]
#[instruction(_bump : u8)]
pub struct InitPool<'info> {
    #[account(mut,signer)]
    owner : AccountInfo<'info>,

    #[account(init, seeds=[(*rand.key).as_ref()], bump=_bump, payer=owner, space=8+POOL_SIZE)]
    pool : ProgramAccount<'info, Pool>,

    #[account(init, payer=owner, space=8+POOL_LEDGER_SIZE)]
    pool_ledger : ProgramAccount<'info,PoolLedger>,

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

    clock : AccountInfo<'info>,
}

pub const POOL_SIZE : usize = 32 // Owner of this account
+32 + 32 // sale mint and account
+32 + 32 // stake mint and account
+32 // random address for transfer authority
+8 // mint price
+8 // Starting time of pool
+8 // Unit of Duration with second.
+8 // endpoint
+32 // lastest ledger of pool
+1; // bump of PDA

#[account]
pub struct Pool{
    pub owner : Pubkey,
    pub sale_mint : Pubkey,
    pub sale_account : Pubkey,
    pub stake_mint : Pubkey,
    pub stake_account : Pubkey,
    pub rand : Pubkey,
    pub mint_price : u64,
    pub start_at : i64,
    pub duration : i64,
    pub endpoint : i64,
    pub last_ledger : Pubkey,
    pub bump : u8,
}

pub const POOL_LEDGER_SIZE : usize = 32 // Pool address
+8 // serial number
+8 // total income
+8 // staked amount
+8 // unstaked amount
+8; // number nft

#[account]
pub struct PoolLedger{
    pub pool : Pubkey,
    pub number : i64,
    pub income : u64,
    pub staked_amount : u64,
    pub unstaked_amount : u64,
    pub number_nft : u64,
}

pub const STAKER_SIZE : usize = 32+32 // Owner and Pool address
+32 //latest ledger of staker
+1; // bump of PDA

#[account]
pub struct Staker{
    pub owner : Pubkey,
    pub pool : Pubkey,
    pub last_ledger : Pubkey,
    pub bump : u8,
}

pub const STAKER_LEDGER_SIZE : usize = 32 // Owner address
+32 // pool address
+8 // serial number
+8 // next serial number
+8 // staked amount
+8 // unstaked amount
+8; // number nft

#[account]
pub struct StakerLedger{
    pub owner : Pubkey,
    pub pool : Pubkey,
    pub number : i64,
    pub next_number : i64,
    pub staked_amount : u64,
    pub unstaked_amount : u64,
    pub number_nft : u64,
}

pub const WITHDRAWN_CHECK_SIZE : usize = 32 // Owner address
+1 // if withdrawn?
+8 // withdraw amount
+32 // last staker ledger
+1; // bump of PDA

#[account]
pub struct WithdrawnCheck{
    pub owner : Pubkey,
    pub withdrawn : bool,
    pub amount : u64,
    pub last_ledger : Pubkey,
    pub bump : u8,
}

#[error]
pub enum PoolError {
    #[msg("Invalid token account")]
    InvalidTokenAccount,

    #[msg("Token mint to failed")]
    TokenMintToFailed,

    #[msg("Token set authority failed")]
    TokenSetAuthorityFailed,

    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("Invalid pool ledger account")]
    InvalidPoolLedgerAccount,

    #[msg("Invalid clock")]
    InvalidClock,

    #[msg("Invalid staker ledger account")]
    InvalidStakerLedgerAccount,

    #[msg("Already withdraw")]
    AlreadyWithdraw,

    #[msg("Invalid duration")]
    InvalidDuration,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Invalid mint account")]
    InvalidMintAccount,

    #[msg("Invalid withdraw time")]
    InvalidWithdrawTime,

    #[msg("Invalid endpoint")]
    InvalidEndpoint,
}