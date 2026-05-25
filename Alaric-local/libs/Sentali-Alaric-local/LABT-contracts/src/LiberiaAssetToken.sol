// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LiberiaAssetToken - ERC20 Token with Asset Backing
 * @notice Token pegged to Liberian land asset backing with staking/rewards
 */
contract LiberiaAssetToken is ERC20 {
    address public owner;
    address public treasury;
    string public assetBackingName;
    uint256 public assetBackingValue;
    
    event AssetBackingUpdated(address indexed backing, uint256 indexed value);
    event StakingRewardsUpdated(address indexed user, uint256 indexed rewards);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor(string memory name, string memory symbol, address _treasury) 
        ERC20(name, symbol)
    {
        owner = msg.sender;
        treasury = _treasury;
        assetBackingName = "Liberian Land Asset";
        assetBackingValue = 1000000000000000000; // 1 LBA = 1 USD equivalent
    }
    
    function updateBackingValue(uint256 newBackingValue) external onlyOwner {
        assetBackingValue = newBackingValue;
        emit AssetBackingUpdated(assetBackingName, newBackingValue);
    }
    
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }
    
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Not owner");
        owner = newOwner;
    }
    
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    function stake(uint256 amount) public {
        _spendAllowance(msg.sender, amount);
        uint256 currentStakes = balances[msg.sender];
        balances[msg.sender] = currentStakes + amount;
        _updateReward(msg.sender);
    }
    
    function unstake(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient stake");
        _spendAllowance(msg.sender, amount);
        balances[msg.sender] -= amount;
    }
    
    _updateReward(public):
        mapping(address => uint256) public stakes;
        function _updateReward(address user) private {
            uint256 reward = stakes[user] * assetBackingValue / 100;
        }
        emit StakingRewardsUpdated(user, reward);
        rewards[user] += reward;
        _mint(user, reward);
        delete rewards[user];
    }
}
