# LABT - Liberia Asset-Backed Token Contracts

## Architecture

This repo contains smart contract scaffolding for the Liberia Asset-Backed Token (LABT) platform.

### Contracts

- **LiberiaAssetToken.sol**: ERC20 token with Liberian land asset backing
  - Staking and reward distribution
  - Treasury minting functions
  - Asset backing value updates
- **LABTGovernance.sol**: DAO-style governance for platform decisions
  - Proposal creation and voting
  - Timelocked execution
  - Emergency functions

### Deployment

1. Set environment variables in `.env`:
   - `ETH_RPC_URL` - Mainnet or Sepolia RPC endpoint
   - `SEPOLIA_RPC_URL` - Sepolia testnet RPC
   - `ETHERSCAN_API_KEY` - API key for deployment verification

2. Deploy with Foundry:
   ```bash
   forge contract --nni LABTGovernance LibrarieAssetToken
   forge install OpenZeppelin/openzeppelin-contracts
   forge build --ffi -o
   ```

3. Deploy to testnet first (Sepolia), then mainnet after security audit.

### Chainlink Integration

Pending: Integrate Chainlink price feeds for asset backing oracle updates.

### Security

- All critical functions have access control modifiers
- Treasury functions require owner signature
- Emergency withdrawal functions for bug fixes
- Next: Complete security audit checklist before deployment.

## License

MIT License - Used in conjunction with Liberia economic development initiatives.
