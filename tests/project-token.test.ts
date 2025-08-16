import { describe, it, expect, beforeEach } from "vitest";

interface Project {
  name: string;
  symbol: string;
  decimals: number;
  maxSupply: bigint;
  totalSupply: bigint;
  owner: string;
  paused: boolean;
  vestingPeriod: number;
}

interface Vesting {
  vestedAmount: bigint;
  releaseBlock: number;
}

interface MockContract {
  platformAdmin: string;
  globalPaused: boolean;
  nextProjectId: number;
  projects: Map<number, Project>;
  balances: Map<string, bigint>; // key: `${projectId}-${account}`
  stakedBalances: Map<string, bigint>; // same
  vestingSchedules: Map<string, Vesting>; // same
  blockHeight: number; // mock block height

  isPlatformAdmin(caller: string): boolean;
  isProjectOwner(projectId: number, caller: string): boolean;
  createProject(
    caller: string,
    name: string,
    symbol: string,
    decimals: number,
    maxSupply: bigint,
    vestingPeriod: number
  ): { value: number } | { error: number };
  mint(
    caller: string,
    projectId: number,
    recipient: string,
    amount: bigint,
    vest: boolean
  ): { value: true } | { error: number };
  claimVested(
    caller: string,
    projectId: number
  ): { value: bigint } | { error: number };
  transfer(
    caller: string,
    projectId: number,
    recipient: string,
    amount: bigint
  ): { value: true } | { error: number };
  stake(
    caller: string,
    projectId: number,
    amount: bigint
  ): { value: true } | { error: number };
  unstake(
    caller: string,
    projectId: number,
    amount: bigint
  ): { value: true } | { error: number };
  burn(
    caller: string,
    projectId: number,
    amount: bigint
  ): { value: true } | { error: number };
  setGlobalPaused(caller: string, pause: boolean): { value: boolean } | { error: number };
  setProjectPaused(caller: string, projectId: number, pause: boolean): { value: boolean } | { error: number };
}

const mockContract: MockContract = {
  platformAdmin: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  globalPaused: false,
  nextProjectId: 1,
  projects: new Map(),
  balances: new Map(),
  stakedBalances: new Map(),
  vestingSchedules: new Map(),
  blockHeight: 100, // initial mock height

  isPlatformAdmin(caller: string) {
    return caller === this.platformAdmin;
  },

  isProjectOwner(projectId: number, caller: string) {
    const project = this.projects.get(projectId);
    return !!project && project.owner === caller;
  },

  createProject(caller, name, symbol, decimals, maxSupply, vestingPeriod) {
    if (this.globalPaused) return { error: 104 };
    const projectId = this.nextProjectId;
    if (this.projects.has(projectId)) return { error: 107 };
    this.projects.set(projectId, {
      name,
      symbol,
      decimals,
      maxSupply,
      totalSupply: 0n,
      owner: caller,
      paused: false,
      vestingPeriod,
    });
    this.nextProjectId++;
    return { value: projectId };
  },

  mint(caller, projectId, recipient, amount, vest) {
    if (this.globalPaused) return { error: 104 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    if (project.paused) return { error: 104 };
    if (!this.isPlatformAdmin(caller) && !this.isProjectOwner(projectId, caller)) return { error: 100 };
    if (amount <= 0n) return { error: 108 };
    const newSupply = project.totalSupply + amount;
    if (newSupply > project.maxSupply) return { error: 103 };
    project.totalSupply = newSupply;
    const key = `${projectId}-${recipient}`;
    if (vest) {
      const releaseBlock = this.blockHeight + project.vestingPeriod;
      const existing = this.vestingSchedules.get(key) || { vestedAmount: 0n, releaseBlock: 0 };
      this.vestingSchedules.set(key, {
        vestedAmount: existing.vestedAmount + amount,
        releaseBlock,
      });
    } else {
      this.balances.set(key, (this.balances.get(key) || 0n) + amount);
    }
    return { value: true };
  },

  claimVested(caller, projectId) {
    if (this.globalPaused) return { error: 104 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    if (project.paused) return { error: 104 };
    const key = `${projectId}-${caller}`;
    const vesting = this.vestingSchedules.get(key);
    if (!vesting) return { error: 106 }; // reusing for not found
    if (this.blockHeight < vesting.releaseBlock) return { error: 109 };
    const amount = vesting.vestedAmount;
    this.vestingSchedules.delete(key);
    this.balances.set(key, (this.balances.get(key) || 0n) + amount);
    return { value: amount };
  },

  transfer(caller, projectId, recipient, amount) {
    if (this.globalPaused) return { error: 104 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    if (project.paused) return { error: 104 };
    if (amount <= 0n) return { error: 108 };
    const senderKey = `${projectId}-${caller}`;
    const senderBal = this.balances.get(senderKey) || 0n;
    if (senderBal < amount) return { error: 101 };
    this.balances.set(senderKey, senderBal - amount);
    const recipKey = `${projectId}-${recipient}`;
    this.balances.set(recipKey, (this.balances.get(recipKey) || 0n) + amount);
    return { value: true };
  },

  stake(caller, projectId, amount) {
    if (this.globalPaused) return { error: 104 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    if (project.paused) return { error: 104 };
    if (amount <= 0n) return { error: 108 };
    const key = `${projectId}-${caller}`;
    const bal = this.balances.get(key) || 0n;
    if (bal < amount) return { error: 101 };
    this.balances.set(key, bal - amount);
    this.stakedBalances.set(key, (this.stakedBalances.get(key) || 0n) + amount);
    return { value: true };
  },

  unstake(caller, projectId, amount) {
    if (this.globalPaused) return { error: 104 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    if (project.paused) return { error: 104 };
    if (amount <= 0n) return { error: 108 };
    const key = `${projectId}-${caller}`;
    const stakeBal = this.stakedBalances.get(key) || 0n;
    if (stakeBal < amount) return { error: 102 };
    this.stakedBalances.set(key, stakeBal - amount);
    this.balances.set(key, (this.balances.get(key) || 0n) + amount);
    return { value: true };
  },

  burn(caller, projectId, amount) {
    if (this.globalPaused) return { error: 104 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    if (project.paused) return { error: 104 };
    if (amount <= 0n) return { error: 108 };
    const key = `${projectId}-${caller}`;
    const bal = this.balances.get(key) || 0n;
    if (bal < amount) return { error: 101 };
    this.balances.set(key, bal - amount);
    project.totalSupply -= amount;
    return { value: true };
  },

  setGlobalPaused(caller, pause) {
    if (!this.isPlatformAdmin(caller)) return { error: 100 };
    this.globalPaused = pause;
    return { value: pause };
  },

  setProjectPaused(caller, projectId, pause) {
    if (!this.isPlatformAdmin(caller) && !this.isProjectOwner(projectId, caller)) return { error: 100 };
    const project = this.projects.get(projectId);
    if (!project) return { error: 106 };
    project.paused = pause;
    return { value: pause };
  },
};

describe("RoboInnovate Project Token Contract", () => {
  beforeEach(() => {
    mockContract.platformAdmin = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    mockContract.globalPaused = false;
    mockContract.nextProjectId = 1;
    mockContract.projects = new Map();
    mockContract.balances = new Map();
    mockContract.stakedBalances = new Map();
    mockContract.vestingSchedules = new Map();
    mockContract.blockHeight = 100;
  });

  it("should create a new project", () => {
    const creator = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const result = mockContract.createProject(creator, "RobotX", "RBX", 6, 1000000n, 100);
    expect(result).toEqual({ value: 1 });
    const project = mockContract.projects.get(1);
    expect(project?.name).toBe("RobotX");
    expect(project?.owner).toBe(creator);
  });

  it("should mint tokens without vesting", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    const result = mockContract.mint(owner, 1, "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP", 500n, false);
    expect(result).toEqual({ value: true });
    expect(mockContract.balances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(500n);
    const project = mockContract.projects.get(1);
    expect(project?.totalSupply).toBe(500n);
  });

  it("should mint tokens with vesting", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    const result = mockContract.mint(owner, 1, "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP", 500n, true);
    expect(result).toEqual({ value: true });
    const vesting = mockContract.vestingSchedules.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP");
    expect(vesting?.vestedAmount).toBe(500n);
    expect(vesting?.releaseBlock).toBe(200);
  });

  it("should claim vested tokens after release block", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const recipient = "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    mockContract.mint(owner, 1, recipient, 500n, true);
    mockContract.blockHeight = 201; // advance block
    const result = mockContract.claimVested(recipient, 1);
    expect(result).toEqual({ value: 500n });
    expect(mockContract.balances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(500n);
    expect(mockContract.vestingSchedules.has("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(false);
  });

  it("should prevent claiming vested tokens before release", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const recipient = "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    mockContract.mint(owner, 1, recipient, 500n, true);
    const result = mockContract.claimVested(recipient, 1);
    expect(result).toEqual({ error: 109 });
  });

  it("should transfer tokens", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const sender = "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    mockContract.mint(owner, 1, sender, 500n, false);
    const result = mockContract.transfer(sender, 1, "ST4J484BBTZZE1F2ML5YJMVF047EZHO4PVGG6G7FQ", 200n);
    expect(result).toEqual({ value: true });
    expect(mockContract.balances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(300n);
    expect(mockContract.balances.get("1-ST4J484BBTZZE1F2ML5YJMVF047EZHO4PVGG6G7FQ")).toBe(200n);
  });

  it("should stake tokens", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const staker = "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    mockContract.mint(owner, 1, staker, 500n, false);
    const result = mockContract.stake(staker, 1, 200n);
    expect(result).toEqual({ value: true });
    expect(mockContract.balances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(300n);
    expect(mockContract.stakedBalances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(200n);
  });

  it("should unstake tokens", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const staker = "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    mockContract.mint(owner, 1, staker, 500n, false);
    mockContract.stake(staker, 1, 200n);
    const result = mockContract.unstake(staker, 1, 100n);
    expect(result).toEqual({ value: true });
    expect(mockContract.stakedBalances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(100n);
    expect(mockContract.balances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(400n);
  });

  it("should burn tokens", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    const burner = "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    mockContract.mint(owner, 1, burner, 500n, false);
    const result = mockContract.burn(burner, 1, 100n);
    expect(result).toEqual({ value: true });
    expect(mockContract.balances.get("1-ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP")).toBe(400n);
    const project = mockContract.projects.get(1);
    expect(project?.totalSupply).toBe(400n);
  });

  it("should prevent actions when global paused", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    mockContract.setGlobalPaused(mockContract.platformAdmin, true);
    const createResult = mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    expect(createResult).toEqual({ error: 104 });
  });

  it("should prevent minting over max supply", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000n, 100);
    const result = mockContract.mint(owner, 1, "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP", 2000n, false);
    expect(result).toEqual({ error: 103 });
  });

  it("should prevent non-owner from pausing project", () => {
    const owner = "ST2CY5V39NHDP5P0C5ATD3ZPWJRF75GY7SJGVD5CT";
    mockContract.createProject(owner, "RobotX", "RBX", 6, 1000000n, 100);
    const result = mockContract.setProjectPaused("ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP", 1, true);
    expect(result).toEqual({ error: 100 });
  });
});