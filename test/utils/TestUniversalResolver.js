const DNS = artifacts.require("./registry/DNSRegistry.sol");
const PublicResolver = artifacts.require("PublicResolver.sol");
const NameWrapper = artifacts.require("DummyNameWrapper.sol");
const UniversalResolver = artifacts.require("UniversalResolver.sol");
const DummyOffchainResolver = artifacts.require("DummyOffchainResolver.sol");
const LegacyResolver = artifacts.require("LegacyResolver.sol");
const ReverseRegistrar = artifacts.require("ReverseRegistrar.sol");

const { expect } = require("chai");
const namehash = require("eth-ens-namehash");
const sha3 = require("web3-utils").sha3;
const { ethers } = require("hardhat");
const { dns } = require("../test-utils");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

contract("UniversalResolver", function(accounts) {
  let dns,
    publicResolver,
    universalResolver,
    dummyOffchainResolver,
    nameWrapper,
    reverseRegistrar,
    reverseNode;

  beforeEach(async () => {
    node = namehash.hash("dao");
    dns = await DNS.new();
    nameWrapper = await NameWrapper.new();
    publicResolver = await PublicResolver.new(
      dns.address,
      nameWrapper.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS
    );
    universalResolver = await UniversalResolver.new(dns.address);
    dummyOffchainResolver = await DummyOffchainResolver.new();
    reverseRegistrar = await ReverseRegistrar.new(dns.address);
    reverseNode = accounts[0].toLowerCase().substring(2) + ".addr.reverse";

    await dns.setSubnodeOwner("0x0", sha3("dao"), accounts[0], {
      from: accounts[0],
    });
    await dns.setSubnodeOwner(namehash.hash("dao"), sha3("test"), accounts[0], {
      from: accounts[0],
    });
    await dns.setSubnodeOwner("0x0", sha3("reverse"), accounts[0], {
      from: accounts[0],
    });
    await dns.setSubnodeOwner(
      namehash.hash("reverse"),
      sha3("addr"),
      reverseRegistrar.address,
      { from: accounts[0] }
    );
    await dns.setResolver(namehash.hash("test.dao"), publicResolver.address, {
      from: accounts[0],
    });
    await dns.setSubnodeOwner(
      namehash.hash("test.dao"),
      sha3("sub"),
      accounts[0],
      { from: accounts[0] }
    );
    await dns.setResolver(namehash.hash("sub.test.dao"), accounts[1], {
      from: accounts[0],
    });
    await publicResolver.methods["setAddr(bytes32,address)"](
      namehash.hash("test.dao"),
      accounts[1],
      { from: accounts[0] }
    );
    await publicResolver.methods[
      "setText(bytes32,string,string)"
    ](namehash.hash("test.dao"), "foo", "bar", { from: accounts[0] });
    await dns.setSubnodeOwner(
      namehash.hash("test.dao"),
      sha3("offchain"),
      accounts[0],
      { from: accounts[0] }
    );
    await dns.setResolver(
      namehash.hash("offchain.test.dao"),
      dummyOffchainResolver.address,
      { from: accounts[0] }
    );

    await reverseRegistrar.claim(accounts[0], {
      from: accounts[0],
    });
    await dns.setResolver(namehash.hash(reverseNode), publicResolver.address, {
      from: accounts[0],
    });
    await publicResolver.setName(namehash.hash(reverseNode), "test.dao");
  });

  describe("findResolver()", () => {
    it("should find an exact match resolver", async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName("test.dao")
      );
      expect(result["0"]).to.equal(publicResolver.address);
    });

    it("should find a resolver on a parent name", async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName("foo.test.dao")
      );
      expect(result["0"]).to.equal(publicResolver.address);
    });

    it("should choose the resolver closest to the leaf", async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName("sub.test.dao")
      );
      expect(result["0"]).to.equal(accounts[1]);
    });
  });

  describe("resolve()", () => {
    it("should resolve a record via legacy methods", async () => {
      const data = (
        await publicResolver.methods["addr(bytes32)"].request(
          namehash.hash("test.dao")
        )
      ).data;
      const result = await universalResolver.resolve(
        dns.hexEncodeName("test.dao"),
        data
      );
      const [ret] = ethers.utils.defaultAbiCoder.decode(
        ["address"],
        result["0"]
      );
      expect(ret).to.equal(accounts[1]);
    });

    describe("resolve()", () => {
      it("should resolve a record if `supportsInterface` throws", async () => {
        const legacyResolver = await LegacyResolver.new();
        await dns.setSubnodeOwner(
          namehash.hash("dao"),
          sha3("test2"),
          accounts[0],
          { from: accounts[0] }
        );
        await dns.setResolver(
          namehash.hash("test2.dao"),
          legacyResolver.address,
          { from: accounts[0] }
        );
        const data = (
          await legacyResolver.methods["addr(bytes32)"].request(
            namehash.hash("test.dao")
          )
        ).data;
        const result = await universalResolver.resolve(
          dns.hexEncodeName("test2.dao"),
          data
        );
        const [ret] = ethers.utils.defaultAbiCoder.decode(
          ["address"],
          result["0"]
        );
        expect(ret).to.equal(legacyResolver.address);
      });

      it("should resolve a record via legacy methods", async () => {
        const data = (
          await publicResolver.methods["addr(bytes32)"].request(
            namehash.hash("test.dao")
          )
        ).data;
        const result = await universalResolver.resolve(
          dns.hexEncodeName("test.dao"),
          data
        );
        const [ret] = ethers.utils.defaultAbiCoder.decode(
          ["address"],
          result["0"]
        );
        expect(ret).to.equal(accounts[1]);
      });

      it("should return a wrapped revert if the resolver reverts with OffchainData", async () => {
        const data = (
          await publicResolver.methods["addr(bytes32)"].request(
            namehash.hash("offchain.test.dao")
          )
        ).data;
        // OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)
        // This is the extraData value the universal resolver should encode
        const extraData = ethers.utils.defaultAbiCoder.encode(
          ["address", "bytes4", "bytes"],
          [
            dummyOffchainResolver.address,
            ethers.utils.hexDataSlice(
              ethers.utils.id("resolveCallback(bytes,bytes)"),
              0,
              4
            ),
            data,
          ]
        );
        await expect(
          universalResolver.resolve(
            dns.hexEncodeName("offchain.test.dao"),
            data
          )
        ).to.be.revertedWith(
          "OffchainLookup(" +
            `"${universalResolver.address}", ` +
            '["https://example.com/"], ' +
            `"${data}", ` +
            '"0xb4a85801", ' +
            `"${extraData}"` +
            ")"
        );
      });
    });
  });

  describe("reverse()", () => {
    const makeEstimateAndResult = async (func, ...args) => ({
      estimate: await func.estimateGas(...args),
      result: await func(...args),
    });
    it("should resolve a reverse record with name and resolver address", async () => {
      const { estimate, result } = await makeEstimateAndResult(
        universalResolver.reverse,
        dns.hexEncodeName(reverseNode)
      );
      console.log("GAS ESTIMATE:", estimate);
      expect(result["0"]).to.equal("test.dao");
      expect(result["1"]).to.equal(accounts[1]);
      expect(result["2"]).to.equal(publicResolver.address);
      expect(result["3"]).to.equal(publicResolver.address);
    });
  });
});
