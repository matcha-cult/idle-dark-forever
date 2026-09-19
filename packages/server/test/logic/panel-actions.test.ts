import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { getActionControllerCmd, getActionMethodSubCmds } from '@nbb-ionet/core-framework';
import {
  BANK_CMD,
  CAREER_CMD,
  INVENTORY_CMD,
  LOOTRULE_CMD,
  PRODUCE_CMD,
  SHOP_CMD,
  STORY_CMD,
} from '@idle-dark/protocol';
import {
  PANEL_ACTION_CLASSES,
  PANEL_CMD_SEGMENTS,
  PANEL_LOGIC_MODULES,
} from '../../src/modules/logic/panel-actions.js';
import { findDuplicateRoutes, type RouteEntry } from '../../src/ionet/route-check.js';

function routesOf(): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const action of PANEL_ACTION_CLASSES) {
    const cmd = getActionControllerCmd(action);
    expect(typeof cmd, `${action.name} 缺少 @ActionController`).toBe('number');
    for (const [method, subCmd] of getActionMethodSubCmds(action)) {
      entries.push({ cmd: cmd!, subCmd, label: `${action.name}.${String(method)}` });
    }
  }
  return entries;
}

describe('panel-actions 登记片段', () => {
  it('每个 Action 都注册了路由且无重复', () => {
    const entries = routesOf();
    expect(entries.length).toBeGreaterThan(20);
    expect(findDuplicateRoutes(entries)).toEqual([]);
  });

  it('覆盖七个面板域的 cmd 段', () => {
    const entries = routesOf();
    const cmds = new Set(entries.map((entry) => entry.cmd));
    for (const segment of PANEL_CMD_SEGMENTS) expect(cmds.has(segment)).toBe(true);
  });

  it('关键 subCmd 均已注册', () => {
    const entries = routesOf();
    const has = (cmd: number, subCmd: number): boolean =>
      entries.some((entry) => entry.cmd === cmd && entry.subCmd === subCmd);

    expect(has(INVENTORY_CMD.cmd, INVENTORY_CMD.list)).toBe(true);
    expect(has(INVENTORY_CMD.cmd, INVENTORY_CMD.changed)).toBe(false); // changed 是推送，不注册请求
    expect(has(INVENTORY_CMD.cmd, INVENTORY_CMD.usePackage)).toBe(true);
    expect(has(BANK_CMD.cmd, BANK_CMD.deposit)).toBe(true);
    expect(has(LOOTRULE_CMD.cmd, LOOTRULE_CMD.setMinLevel)).toBe(true);
    expect(has(CAREER_CMD.cmd, CAREER_CMD.selectEnhance)).toBe(true);
    expect(has(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineReset)).toBe(true);
    expect(has(STORY_CMD.cmd, STORY_CMD.finish)).toBe(true);
    expect(has(SHOP_CMD.cmd, SHOP_CMD.exchange)).toBe(true);
  });

  it('模块表把全局「当前角色」模块排在最前且只出现一次', () => {
    const names = PANEL_LOGIC_MODULES.map((module) => module.name);
    expect(names.filter((name) => name === 'PanelCharacterModule')).toHaveLength(1);
    expect(names[0]).toBe('PanelCharacterModule');
  });
});
