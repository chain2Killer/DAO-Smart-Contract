## Data Flow

I seperated pool data with Pool and PoolLedger accounts. To be honest, We can merge both accounts.

But I wanted to store constant and variable data of pool in each account.

Pool account is for constant data and PoolLedger account is for variable data.


And in Anchor, if account size is greater than 1024 bytes, we cannot use anchor interpertor for structure.

So I used to tradition method for updating account data.

## Algorithm

1. Stake / Unstake

We have to check accounts.

	- If transaction time is smaller than starting time of pool, this pool is not started yet.
	
	- If transaction time is greater than ending time(10 years in our case) of pool, this pool is already ended.
	
	- We check if pool and pool ledger is a pair.
	
	- We check if account that will get(for "stake")/send(for "unstake") staking token is one of pool.


Then we update ledger data.

	- If current time is not matched last time of pool, we have to update ledger data from last time to current time(in real we update including next ledger.)
	- If not, we add/minus staking amount to next ledger.

At the end, we update staker data and last time of pool.

2. Deposit

Here, We also have to check accounts for the first time. This processing is simmilar to "Stake/Unstake" processing.

In Deposit, income is added to current ledger(not next ledger).

3. Withdraw

We get total withdrawable amount.(from last withdrawn time to current time).

And then Pool sends token(total amount) to user.

At the end, we update withdraw time of staker account.