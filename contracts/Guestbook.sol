// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Stand-in for a grantee's live product. Its public entryCount() is the on-chain
/// activity metric a Vestry milestone can require before a tranche is released.
contract Guestbook {
    uint256 public entryCount;
    mapping(address => bool) public signed;

    event Signed(address indexed visitor, uint256 entryCount, string note);

    error AlreadySigned();

    /// One entry per address, so the metric counts distinct users, not repeated calls.
    function sign(string calldata note) external {
        if (signed[msg.sender]) revert AlreadySigned();
        signed[msg.sender] = true;
        entryCount += 1;
        emit Signed(msg.sender, entryCount, note);
    }
}
