const { ethers } = require('hardhat')
const {
  labelhash,
  namehash,
  encodeName,
  FUSES,
  MAX_EXPIRY,
} = require('../test-utils/ens')
const { EMPTY_ADDRESS } = require('../test-utils/constants')

const { expect } = require('chai')

// States
// Expiry > block.timestamp	CU burned	PCC burned	Parent burned parent's CU
// CU = CANNOT_UNWRAP
// PCC = PARENT_CANNOT_CONTROL

// Each describe represents a specific state
// 0000 = Default Wrapped (DW)
// 1000 = Not expired (NE)
// 0100 = CU burned (CU)
// 0010 = PCC burned (PCC)
// 0001 = Parent burned parent's CU (PCU)
// Each can be combined to represent multiple states

const {
  CANNOT_UNWRAP,
  CANNOT_SET_RESOLVER,
  PARENT_CANNOT_CONTROL,
  CAN_DO_EVERYTHING,
} = FUSES

const DAY = 84600

function shouldRespectConstraints(contracts, getSigners) {
  let account
  let account2
  let BaseRegistrar
  let NameWrapper
  let NameWrapper2
  let DnsRegistry
  let DnsRegistry2

  let parentLabel = 'test1'
  let parentLabelHash = labelhash(parentLabel)
  let parentNode = namehash('test1.dao')
  let childNode = namehash('sub.test1.dao')
  let childLabel = 'sub'
  let childLabelHash = labelhash(childLabel)

  before(async () => {
    const signers = getSigners()
    account = await signers[0].getAddress()
    account2 = await signers[1].getAddress()
    ;({ BaseRegistrar, NameWrapper, NameWrapper2, DnsRegistry, DnsRegistry2 } =
      contracts())
    await BaseRegistrar.setApprovalForAll(NameWrapper.address, true)
  })

  // Reusable state setup

  async function setupState({
    parentNode,
    parentLabel,
    childLabel,
    parentFuses,
    childFuses,
    childExpiry,
  }) {
    await BaseRegistrar.register(labelhash(parentLabel), account, 84600)
    await NameWrapper.wrapETH2LD(
      parentLabel,
      account,
      parentFuses,
      MAX_EXPIRY,
      EMPTY_ADDRESS,
    )

    await NameWrapper.setSubnodeOwner(
      parentNode,
      childLabel,
      account2,
      childFuses,
      childExpiry, // Expired
    )
  }

  async function setupState0000DW({ parentNode, parentLabel, childLabel }) {
    // Expired, nothing burnt.
    await setupState({
      parentNode,
      parentLabel,
      childLabel,
      parentFuses: CAN_DO_EVERYTHING,
      childFuses: CAN_DO_EVERYTHING,
      childExpiry: 0,
    })
    const [, parentFuses] = await NameWrapper.getData(parentNode)
    expect(parentFuses).to.equal(PARENT_CANNOT_CONTROL)
    const [, childFuses, childExpiry] = await NameWrapper.getData(childNode)
    expect(childFuses).to.equal(CAN_DO_EVERYTHING)
    expect(childExpiry).to.equal(0)
  }

  async function setupState0001PCU({ parentNode, parentLabel, childLabel }) {
    // PCU
    await setupState({
      parentNode,
      parentLabel,
      childLabel,
      parentFuses: CANNOT_UNWRAP,
      childFuses: CAN_DO_EVERYTHING,
      childExpiry: 0,
    })
    const [, parentFuses] = await NameWrapper.getData(parentNode)
    expect(parentFuses).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    const [, childFuses, childExpiry] = await NameWrapper.getData(childNode)
    expect(childFuses).to.equal(CAN_DO_EVERYTHING)
    expect(childExpiry).to.equal(0)
  }

  async function setupStateUnexpired({
    parentNode,
    parentLabel,
    childLabel,
    childFuses,
    parentFuses,
  }) {
    await BaseRegistrar.register(labelhash(parentLabel), account, DAY * 2)
    const parentExpiry = await BaseRegistrar.nameExpires(labelhash(parentLabel))
    await NameWrapper.wrapETH2LD(
      parentLabel,
      account,
      parentFuses,
      MAX_EXPIRY,
      EMPTY_ADDRESS,
    )

    await NameWrapper.setSubnodeOwner(
      parentNode,
      childLabel,
      account2,
      childFuses,
      parentExpiry - 86400, // Expires a day before parent
    )
  }

  async function setupState1000NE({ parentNode, parentLabel, childLabel }) {
    await setupStateUnexpired({
      parentNode,
      parentLabel,
      childLabel,
      childFuses: CAN_DO_EVERYTHING,
      parentFuses: CAN_DO_EVERYTHING,
    })

    const [, parentFuses, parentExpiry] = await NameWrapper.getData(parentNode)
    expect(parentFuses).to.equal(PARENT_CANNOT_CONTROL)
    const [, childFuses, childExpiry] = await NameWrapper.getData(childNode)
    expect(childFuses).to.equal(CAN_DO_EVERYTHING)
    expect(childExpiry).to.equal(parentExpiry - 86400)
  }

  async function setupState1001NE_PCU({ parentNode, parentLabel, childLabel }) {
    await setupStateUnexpired({
      parentNode,
      parentLabel,
      childLabel,
      childFuses: CAN_DO_EVERYTHING,
      parentFuses: CANNOT_UNWRAP,
    })

    const [, parentFuses, parentExpiry] = await NameWrapper.getData(parentNode)
    expect(parentFuses).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    const [, childFuses, childExpiry] = await NameWrapper.getData(childNode)
    expect(childFuses).to.equal(CAN_DO_EVERYTHING)
    expect(childExpiry).to.equal(parentExpiry - 86400)
  }

  async function setupState1011NE_PCC_PCU({
    parentNode,
    parentLabel,
    childLabel,
  }) {
    await setupStateUnexpired({
      parentNode,
      parentLabel,
      childLabel,
      childFuses: PARENT_CANNOT_CONTROL,
      parentFuses: CANNOT_UNWRAP,
    })

    const [, parentFuses, parentExpiry] = await NameWrapper.getData(parentNode)
    expect(parentFuses).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    const [, childFuses, childExpiry] = await NameWrapper.getData(childNode)
    expect(childFuses).to.equal(PARENT_CANNOT_CONTROL)
    expect(childExpiry).to.equal(parentExpiry - 86400)
  }

  async function setupState1111NE_CU_PCC_PCU({
    parentNode,
    parentLabel,
    childLabel,
  }) {
    await setupStateUnexpired({
      parentNode,
      parentLabel,
      childLabel,
      childFuses: PARENT_CANNOT_CONTROL | CANNOT_UNWRAP,
      parentFuses: CANNOT_UNWRAP,
    })

    const [, parentFuses, parentExpiry] = await NameWrapper.getData(parentNode)
    expect(parentFuses).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    const [, childFuses, childExpiry] = await NameWrapper.getData(childNode)
    expect(childFuses).to.equal(PARENT_CANNOT_CONTROL | CANNOT_UNWRAP)
    expect(childExpiry).to.equal(parentExpiry - 86400)
  }

  // Reusable tests

  function parentCanExtend({
    parentNode,
    parentLabelHash,
    childLabel,
    childLabelHash,
    childNode,
    isNotExpired,
  }) {
    if (isNotExpired) {
      it('Child should have an expiry < parent', async () => {
        const [, , childExpiry] = await NameWrapper.getData(childNode)
        const parentExpiry = await BaseRegistrar.nameExpires(parentLabelHash)
        expect(childExpiry.toNumber()).to.be.lessThan(parentExpiry.toNumber())
        const blockNumber = await ethers.provider.getBlockNumber()
        const timestamp = (await ethers.provider.getBlock(blockNumber))
          .timestamp
        expect(childExpiry.toNumber()).to.be.greaterThan(timestamp)
      })
    } else {
      it('Child should have a 0 expiry before extending', async () => {
        const [, , expiryBefore] = await NameWrapper.getData(childNode)
        expect(expiryBefore).to.equal(0)
      })
    }

    it('Parent can extend expiry with setChildFuses()', async () => {
      const parentExpiry = await BaseRegistrar.nameExpires(labelhash('test1'))
      await NameWrapper.setChildFuses(parentNode, childLabelHash, 0, MAX_EXPIRY)
      const [, , expiry] = await NameWrapper.getData(childNode)
      expect(expiry).to.be.bignumber.equal(parentExpiry)
    })

    it('Parent can extend expiry with setSubnodeOwner()', async () => {
      const parentExpiry = await BaseRegistrar.nameExpires(labelhash('test1'))
      await NameWrapper.setSubnodeOwner(
        parentNode,
        childLabel,
        account2,
        CAN_DO_EVERYTHING,
        MAX_EXPIRY,
      )
      const [, , expiry] = await NameWrapper.getData(childNode)
      expect(expiry).to.be.bignumber.equal(parentExpiry)
    })

    it('Parent can extend expiry with setSubnodeRecord()', async () => {
      const parentExpiry = await BaseRegistrar.nameExpires(labelhash('test1'))
      await NameWrapper.setSubnodeRecord(
        parentNode,
        childLabel,
        account2,
        EMPTY_ADDRESS,
        0,
        CAN_DO_EVERYTHING,
        MAX_EXPIRY,
      )
      const [, , expiry] = await NameWrapper.getData(childNode)
      expect(expiry).to.be.bignumber.equal(parentExpiry)
    })
  }

  function parentCanExtendWithSetChildFuses({
    parentNode,
    childLabel,
    childLabelHash,
    childNode,
  }) {
    it('Child should have a 0 expiry before extending', async () => {
      const [, , childExpiry] = await NameWrapper.getData(childNode)
      const parentExpiry = await BaseRegistrar.nameExpires(parentLabelHash)
      expect(childExpiry.toNumber()).to.be.lessThan(parentExpiry.toNumber())
      const blockNumber = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp
      expect(childExpiry.toNumber()).to.be.greaterThan(timestamp)
    })

    it('Parent can extend expiry with setChildFuses()', async () => {
      const parentExpiry = await BaseRegistrar.nameExpires(labelhash('test1'))
      await NameWrapper.setChildFuses(parentNode, childLabelHash, 0, MAX_EXPIRY)
      const [, , expiry] = await NameWrapper.getData(childNode)
      expect(expiry).to.be.bignumber.equal(parentExpiry)
    })

    it('Parent cannot extend expiry with setSubnodeOwner()', async () => {
      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CAN_DO_EVERYTHING,
          MAX_EXPIRY,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}"`)
    })

    it('Parent cannot extend expiry with setSubnodeRecord()', async () => {
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CAN_DO_EVERYTHING,
          MAX_EXPIRY,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}"`)
    })
  }

  function parentCanReplaceOwner({ parentNode, childLabel, childNode }) {
    it('Parent can replace owner with setSubnodeOwner()', async () => {
      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)

      await NameWrapper.setSubnodeOwner(
        parentNode,
        childLabel,
        account,
        CAN_DO_EVERYTHING,
        0,
      )

      expect(await NameWrapper.ownerOf(childNode)).to.equal(account)
    })

    it('Parent can replace owner with setSubnodeRecord()', async () => {
      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)

      await NameWrapper.setSubnodeRecord(
        parentNode,
        childLabel,
        account,
        EMPTY_ADDRESS,
        0,
        CAN_DO_EVERYTHING,
        0,
      )

      expect(await NameWrapper.ownerOf(childNode)).to.equal(account)
    })
  }

  function parentCanUnwrapChild({
    childNode,
    childLabelHash,
    childLabel,
    parentNode,
  }) {
    it('Parent can unwrap owner with setSubnodeRecord() and then unwrap', async () => {
      //check previous owners
      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)
      expect(await DnsRegistry.owner(childNode)).to.equal(NameWrapper.address)

      await NameWrapper.setSubnodeRecord(
        parentNode,
        childLabel,
        account,
        EMPTY_ADDRESS,
        0,
        CAN_DO_EVERYTHING,
        0,
      )

      await NameWrapper.unwrap(parentNode, childLabelHash, account)
      expect(await NameWrapper.ownerOf(childNode)).to.equal(EMPTY_ADDRESS)
      expect(await DnsRegistry.owner(childNode)).to.equal(account)
    })
  }

  function ownerCannotBurnFuses({ childNode }) {
    it('Owner cannot burn CU because PCC is unburnt', async () => {
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_UNWRAP),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })

    it('Owner cannot burn other fuses because CU and PCC is unburnt', async () => {
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_SET_RESOLVER),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  }

  function ownerCanUnwrap({ childNode, childLabelHash }) {
    it('Owner can unwrap', async () => {
      await NameWrapper2.unwrap(parentNode, childLabelHash, account)
      expect(await NameWrapper.ownerOf(childNode)).to.equal(EMPTY_ADDRESS)
    })
  }

  function parentCannotBurnFusesOrPCC({
    childNode,
    childLabelHash,
    parentNode,
  }) {
    it('Parent cannot burn fuses with setChildFuses()', async () => {
      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
      //TODO: This should revert because the parent has not burned CU
    })

    it('Parent cannot burn fuses with setSubnodeOwner()', async () => {
      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })

    it('Parent cannot burn fuses with setSubnodeRecord()', async () => {
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  }

  function parentCanBurnFusesOrPCC({ childNode, childLabelHash, parentNode }) {
    it('Parent can burn fuses with setChildFuses()', async () => {
      await NameWrapper.setChildFuses(
        parentNode,
        childLabelHash,
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
        0,
      )

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
      )
    })

    it('Parent can burn fuses with setSubnodeOwner()', async () => {
      await NameWrapper.setSubnodeOwner(
        parentNode,
        childLabel,
        account2,
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
        0,
      )

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
      )
    })

    it('Parent can burn fuses with setSubnodeRecord()', async () => {
      await NameWrapper.setSubnodeRecord(
        parentNode,
        childLabel,
        account2,
        EMPTY_ADDRESS,
        0,
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
        0,
      )

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
      )
    })

    it('Parent cannot burn fuses if PCC is not burnt too', async () => {
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CANNOT_UNWRAP | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          CANNOT_UNWRAP | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CANNOT_UNWRAP | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.revertedWith(`OperationProhibited("${childNode}")`)
    })
  }

  function parentCannotBurnFusesWhenPCCisBurned({
    childNode,
    childLabelHash,
    parentNode,
  }) {
    it('Parent cannot burn fuses with setChildFuses()', async () => {
      expect((await NameWrapper.getData(childNode))[1]).to.equal(
        PARENT_CANNOT_CONTROL,
      )
      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      // parent can burn PCC again, but has no effect since it's already burnt
      await NameWrapper.setChildFuses(
        parentNode,
        childLabelHash,
        PARENT_CANNOT_CONTROL,
        0,
      )

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL)
    })

    it('Parent cannot burn fuses with setSubnodeOwner()', async () => {
      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CANNOT_UNWRAP | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          PARENT_CANNOT_CONTROL | CANNOT_UNWRAP | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })

    it('Parent cannot burn fuses with setSubnodeRecord()', async () => {
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  }

  function parentCannotReplaceOwner({ parentNode, childLabel, childNode }) {
    it('Parent cannot replace owner with setSubnodeOwner()', async () => {
      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)

      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account,
          CAN_DO_EVERYTHING,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)
    })

    it('Parent cannot replace owner with setSubnodeRecord()', async () => {
      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)

      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account,
          EMPTY_ADDRESS,
          0,
          CAN_DO_EVERYTHING,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      expect(await NameWrapper.ownerOf(childNode)).to.equal(account2)
    })
  }

  function parentCannotUnwrapChild({
    parentLabelHash,
    childNode,
    childLabelHash,
  }) {
    it('Parent cannot unwrap itself', async () => {
      await expect(
        NameWrapper.unwrapETH2LD(parentLabelHash, account, account),
      ).to.be.revertedWith(`OperationProhibited("${parentNode}")`)
    })

    it('Parent cannot unwrap child', async () => {
      await expect(
        NameWrapper.unwrap(parentNode, childLabelHash, account),
      ).to.be.revertedWith(`Unauthorised("${childNode}", "${account}")`)
    })

    it('Parent cannot call dns.subnodeOwner to forcefully unwrap', async () => {
      await expect(DnsRegistry.setSubnodeOwner(parentNode, childNode, account))
        .to.be.reverted
    })
  }

  function testStateTransition1000to1010({
    parentNode,
    parentLabel,
    childLabel,
    childLabelHash,
  }) {
    // TODO this should revert
    it('1000 => 1010 - Parent cannot burn PCC with setChildFuses()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })
    it('1000 => 1010 - Parent cannot burn PCC with setSubnodeOwner()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
    it('1000 => 1010 - Parent cannot burn PCC with setSubnodeRecord()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  }

  describe("0000 - Wrapped expired without CU/PCC burned, Parent's CU not burned", () => {
    let result
    beforeEach(async () => {
      await setupState0000DW({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    parentCanExtend({
      parentNode,
      childLabel,
      childLabelHash,
      childNode,
    })

    // TODO: replace with parentCannotBurnFuses({ childNode, childLabelHash, parentNode })

    parentCannotBurnFusesOrPCC({ childLabelHash, childNode, parentNode })

    it('Parent cannot burn fuses with setChildFuses() even with extending expiry', async () => {
      const [, fusesBefore] = await NameWrapper.getData(childNode)
      expect(fusesBefore).to.equal(0)
      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })

    parentCanReplaceOwner({ parentNode, childLabel, childNode })

    parentCanUnwrapChild({ childNode, childLabelHash, childLabel, parentNode })

    ownerCannotBurnFuses({ childNode })

    ownerCanUnwrap({ childNode, childLabelHash })
  })

  describe("0001 - PCU - Wrapped expired without CU/PCC burned, Parent's CU is burned", () => {
    let result

    beforeEach(async () => {
      await BaseRegistrar.register(labelhash('test1'), account, 84600)
      await NameWrapper.wrapETH2LD(
        'test1',
        account,
        CANNOT_UNWRAP, // Parent's CU is burned
        MAX_EXPIRY,
        EMPTY_ADDRESS,
      )

      await NameWrapper.setSubnodeOwner(
        parentNode,
        childLabel,
        account2,
        CAN_DO_EVERYTHING, // Node's CU/PCC not burned
        0, // Expired
      )
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    parentCanExtend({ parentNode, childLabel, childLabelHash, childNode })

    it('Parent cannot burn fuses with setChildFuses()', async () => {
      const [, fusesBefore] = await NameWrapper.getData(childNode)
      expect(fusesBefore).to.equal(0)
      await NameWrapper.setChildFuses(
        parentNode,
        childLabelHash,
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL | CANNOT_SET_RESOLVER,
        0,
      )

      // expired names get normalised to 0
      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(0)
    })

    it('Parent can burn fuses with setChildFuses() if expiry is also extended', async () => {
      const [, fusesBefore] = await NameWrapper.getData(childNode)
      expect(fusesBefore).to.equal(0)
      await NameWrapper.setChildFuses(
        parentNode,
        childLabelHash,
        CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
        MAX_EXPIRY,
      )

      // expired names get normalised to 0
      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    })

    parentCanReplaceOwner({ parentNode, childLabel, childNode })
    parentCanUnwrapChild({ childNode, childLabelHash, childLabel, parentNode })

    it('Parent cannot unwrap itself', async () => {
      await expect(
        NameWrapper.unwrapETH2LD(parentLabelHash, account, account),
      ).to.be.revertedWith(`OperationProhibited("${parentNode}")`)
    })

    ownerCannotBurnFuses({ childNode })
    ownerCanUnwrap({ childNode, childLabelHash })
  })

  describe("0010 - PCC -  Impossible state - WrappedPCC burned without Parent's CU ", () => {
    // starts with the same setup as 0000 to test that this state is impossible
    let result
    beforeEach(async () => {
      await setupState0000DW({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    it('0000 => 0010 - Parent cannot burn PCC with setChildFuses()', async () => {
      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
      // TODO: this should revert
    })
  })

  describe("0011 - PCC_PCU - Impossible state - Wrapped expired, PCC burned and Parent's CU burned ", () => {
    let result
    beforeEach(async () => {
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    it('0001 => 0010 - PCU => PCC - Parent cannot burn PCC with setChildFuses()', async () => {
      await setupState0001PCU({ parentNode, parentLabel, childLabel })

      await NameWrapper.setChildFuses(
        parentNode,
        childLabelHash,
        PARENT_CANNOT_CONTROL,
        0,
      )

      const [, fuses] = await NameWrapper.getData(childNode)

      // fuses are normalised
      expect(fuses).to.equal(0)
    })
  })

  describe("0100 - CU - Impossible state - Wrapped expired, CU burned, PCC unburned and Parent's CU unburned ", () => {
    let result
    beforeEach(async () => {
      await setupState0000DW({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    it('0000 => 0100 - DW => CU Parent - cannot burn CANNOT_UNWRAP with setChildFuses()', async () => {
      await expect(
        NameWrapper.setChildFuses(parentNode, childLabelHash, CANNOT_UNWRAP, 0),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('0000 => 0100 - DW => CU - Owner cannot burn CANNOT_UNWRAP with setFuses()', async () => {
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_UNWRAP),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })
  })

  describe("0101 - Impossible state - Wrapped expired, CU burned, PCC unburned and Parent's CU burned ", () => {
    let result
    beforeEach(async () => {
      await setupState0001PCU({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    it('0001 => 0101 - PCU => CU_PCU - Parent cannot burn CANNOT_UNWRAP with setChildFuses()', async () => {
      await expect(
        NameWrapper.setChildFuses(parentNode, childLabelHash, CANNOT_UNWRAP, 0),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('0001 => 0101 - PCU => CU_PCU -  Owner cannot burn CANNOT_UNWRAP with setFuses()', async () => {
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_UNWRAP),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })
  })

  describe("0110 - CU_PCC - Impossible state - Wrapped expired, CU burned, PCC burned and Parent's CU unburned ", () => {
    let result
    beforeEach(async () => {
      await setupState0000DW({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    it('0000 => 0010 - DW => PCC - Parent cannot burn PARENT_CANNOT_CONTROL with setChildFuses()', async () => {
      await expect(
        NameWrapper.setChildFuses(
          parentNode,
          childLabelHash,
          PARENT_CANNOT_CONTROL,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
      //TODO should revert
    })
  })

  describe("0111 - CU_PCC_PCU - Impossible state - Wrapped expired, CU burned, PCC burned and Parent's CU burned ", () => {
    let result
    beforeEach(async () => {
      await setupState0001PCU({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    it('0001 => 0111 - PCU => CU_PCC_PCU - Parent cannot burn PARENT_CANNOT_CONTROL | CANNOT_UNWRAP with setChildFuses()', async () => {
      await NameWrapper.setChildFuses(
        parentNode,
        childLabelHash,
        PARENT_CANNOT_CONTROL | CANNOT_UNWRAP,
        0,
      )

      const [, fuses, expiry] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(0)
    })
  })

  describe("1000 - NE - Wrapped, but not expired, CU, PCC, and Parent's CU unburned ", () => {
    let result
    beforeEach(async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    parentCanExtend({
      parentLabelHash,
      parentNode,
      childLabel,
      childLabelHash,
      childNode,
      isNotExpired: true,
    })
    parentCannotBurnFusesOrPCC({
      childNode,
      childLabelHash,
      parentNode,
    })
    parentCanReplaceOwner({ parentNode, childLabel, childNode })
    parentCanUnwrapChild({ childNode, childLabelHash, childLabel, parentNode })
    ownerCannotBurnFuses({ childNode })
    ownerCanUnwrap({ childNode, childLabelHash })
  })

  describe("1001 - NE_PCU - Wrapped unexpired, CU and PCC unburned, and Parent's CU burned ", () => {
    let result
    beforeEach(async () => {
      await setupState1001NE_PCU({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    parentCanExtend({
      parentLabelHash,
      parentNode,
      childLabel,
      childLabelHash,
      childNode,
      isNotExpired: true,
    })

    parentCanBurnFusesOrPCC({ childNode, childLabelHash, parentNode })
    parentCanReplaceOwner({ parentNode, childLabel, childNode })
    parentCanUnwrapChild({ childNode, childLabelHash, childLabel, parentNode })
    ownerCannotBurnFuses({ childNode })
    ownerCanUnwrap({ childNode, childLabelHash })
  })

  describe("1010 - NE_PCC - Impossible state - Wrapped unexpired, CU unburned, PCC burned and Parent's CU burned ", () => {
    testStateTransition1000to1010({
      parentNode,
      parentLabel,
      childLabel,
      childLabelHash,
    })
  })

  describe("1011 - NE_PCC_PCU Wrapped unexpired, CU, PCC and Parent's CU burned ", () => {
    let result
    beforeEach(async () => {
      await setupState1011NE_PCC_PCU({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    parentCanExtendWithSetChildFuses({
      parentNode,
      childLabel,
      childLabelHash,
      childNode,
    })

    parentCannotBurnFusesWhenPCCisBurned({
      childNode,
      childLabelHash,
      parentNode,
    })

    it('Parent cannot unburn fuses with setChildFuses()', async () => {
      await NameWrapper.setChildFuses(parentNode, childLabelHash, 0, 0)

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL)
    })

    it('Parent cannot unburn fuses with setSubnodeOwner()', async () => {
      await expect(
        NameWrapper.setSubnodeOwner(parentNode, childLabel, account2, 0, 0),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL)
    })

    it('Parent cannot unburn fuses with setSubnodeRecord()', async () => {
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          0,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL)
    })

    parentCannotReplaceOwner({ parentNode, childLabel, childNode })

    parentCannotUnwrapChild({ parentLabelHash, childNode, childLabelHash })

    it('Owner can burn CU', async () => {
      await NameWrapper2.setFuses(childNode, CANNOT_UNWRAP)
      const [, fuses] = await NameWrapper2.getData(childNode)
      expect(fuses).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    })

    it('Owner cannot burn fuses because CU is unburnt', async () => {
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_SET_RESOLVER),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })

    it('Owner cannot unwrap and wrap to unburn PCC', async () => {
      const [, fusesBefore] = await NameWrapper2.getData(childNode)
      expect(fusesBefore).to.equal(PARENT_CANNOT_CONTROL)
      await NameWrapper2.unwrap(parentNode, childLabelHash, account2)
      await DnsRegistry2.setApprovalForAll(NameWrapper2.address, true)
      await NameWrapper2.wrap(
        encodeName(`${childLabel}.${parentLabel}.dao`),
        account2,
        EMPTY_ADDRESS,
      )
      const [, fusesAfter] = await NameWrapper2.getData(childNode)
      expect(fusesAfter).to.equal(PARENT_CANNOT_CONTROL)
    })

    ownerCanUnwrap({ childNode, childLabelHash })
  })

  describe("1100 - NE_CU - Impossible State - Wrapped unexpired, CU burned, and PCC and Parent's CU unburned ", () => {
    it('1000 => 1100 - NE => NE_CU - Parent cannot burn CU with setChildFuses()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setChildFuses(parentNode, childLabelHash, CANNOT_UNWRAP, 0),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('1000 => 1100 - NE => NE_CU - Parent cannot burn CU with setSubnodeOwner()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CANNOT_UNWRAP,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('1000 => 1100 - NE => NE_CU - Parent cannot burn CU with setSubnodeRecord()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CANNOT_UNWRAP,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('1000 => 1100 - NE => NE_CU - Owner cannot burn CU with setFuses()', async () => {
      await setupState1000NE({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_UNWRAP),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  })

  describe("1101 - NE_CU_PCU -  Impossible State - Wrapped unexpired, CU burned, PCC unburned, and Parent's CU burned ", () => {
    it('1001 => 1101 - NE_PCU => NE_CU_PCU -  Parent cannot burn CU with setChildFuses()', async () => {
      await setupState1001NE_PCU({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setChildFuses(parentNode, childLabelHash, CANNOT_UNWRAP, 0),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('1001 => 1101 - NE_PCU => NE_CU_PCU - Parent cannot burn CU with setSubnodeOwner()', async () => {
      await setupState1001NE_PCU({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setSubnodeOwner(
          parentNode,
          childLabel,
          account2,
          CANNOT_UNWRAP,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('1001 => 1101 - NE_PCU => NE_CU_PCU - Parent cannot burn CU with setSubnodeRecord()', async () => {
      await setupState1001NE_PCU({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          CANNOT_UNWRAP,
          0,
        ),
      ).to.be.revertedWith(
        `OperationProhibited("0xbbfc5977efa6590c5b92becdf2b363e7141059ae414f877b9f9f30a1a416fefb")`,
      )
    })

    it('1001 => 1101 - NE_PCU => NE_CU_PCU - Owner cannot burn CU with setFuses()', async () => {
      await setupState1001NE_PCU({ parentNode, parentLabel, childLabel })
      await expect(
        NameWrapper2.setFuses(childNode, CANNOT_UNWRAP),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  })

  describe("1110 - NE_CU_PCC - Impossible state -  Wrapped unexpired, CU and PCC burned, and Parent's CU unburned ", () => {
    testStateTransition1000to1010({
      parentNode,
      parentLabel,
      childLabel,
      childLabelHash,
    })
  })

  describe("1111 - NE_CU_PCC_PCU - Wrapped unexpired, CU, PCC and Parent's CU burned ", () => {
    let result
    beforeEach(async () => {
      await setupState1111NE_CU_PCC_PCU({ parentNode, parentLabel, childLabel })
      result = await ethers.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [result])
    })

    parentCanExtendWithSetChildFuses({
      parentNode,
      childLabel,
      childLabelHash,
      childNode,
    })

    it('Parent cannot unburn fuses with setChildFuses()', async () => {
      await NameWrapper.setChildFuses(parentNode, childLabelHash, 0, 0)

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL | CANNOT_UNWRAP)
    })

    it('Parent cannot unburn fuses with setSubnodeOwner()', async () => {
      await expect(
        NameWrapper.setSubnodeOwner(parentNode, childLabel, account2, 0, 0),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL | CANNOT_UNWRAP)
    })

    it('Parent cannot unburn fuses with setSubnodeRecord()', async () => {
      await expect(
        NameWrapper.setSubnodeRecord(
          parentNode,
          childLabel,
          account2,
          EMPTY_ADDRESS,
          0,
          0,
          0,
        ),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)

      const [, fuses] = await NameWrapper.getData(childNode)
      expect(fuses).to.equal(PARENT_CANNOT_CONTROL | CANNOT_UNWRAP)
    })

    parentCannotReplaceOwner({ parentNode, childLabel, childNode })

    parentCannotUnwrapChild({ parentLabelHash, childNode, childLabelHash })

    it('Owner can burn fuses', async () => {
      const [, fusesBefore] = await NameWrapper2.getData(childNode)
      expect(fusesBefore).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
      await NameWrapper2.setFuses(childNode, CANNOT_SET_RESOLVER)
      const [, fusesAfter] = await NameWrapper2.getData(childNode)
      expect(fusesAfter).to.equal(
        CANNOT_SET_RESOLVER | CANNOT_UNWRAP | PARENT_CANNOT_CONTROL,
      )
    })

    it('Owner cannot unburn fuses', async () => {
      const [, fusesBefore] = await NameWrapper2.getData(childNode)
      expect(fusesBefore).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
      await NameWrapper2.setFuses(childNode, 0)
      const [, fusesAfter] = await NameWrapper2.getData(childNode)
      expect(fusesAfter).to.equal(CANNOT_UNWRAP | PARENT_CANNOT_CONTROL)
    })

    it('Owner cannot unwrap', async () => {
      await expect(
        NameWrapper2.unwrap(parentNode, childLabelHash, account2),
      ).to.be.revertedWith(`OperationProhibited("${childNode}")`)
    })
  })
}

module.exports = {
  shouldRespectConstraints,
}
