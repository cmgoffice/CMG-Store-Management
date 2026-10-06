import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/stockIdentity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { assertStockIdentityMatches } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('allows the same stock code with different casing and whitespace', () => {
  assert.doesNotThrow(() => assertStockIdentityMatches({
    itemNo: ' Formwork-084 ', materialNo: 'FORMWORK-084',
  }, 'formwork-084'));
});

test('allows legacy stock with no materialNo when itemNo matches', () => {
  assert.doesNotThrow(() => assertStockIdentityMatches({ itemNo: 'Formwork-085' }, 'FORMWORK-085'));
});

test('rejects the two corrupted J02B destinations instead of adding transfer quantities', () => {
  for (const [itemNo, materialNo] of [['FORMWORK-052', 'FORMWORK-084'], ['FORMWORK-053', 'FORMWORK-085']]) {
    assert.throws(() => assertStockIdentityMatches({ itemNo, materialNo }, materialNo), /ข้อมูลสต็อกมีรหัสขัดกัน/);
  }
});

test('rejects a destination document whose materialNo belongs to another product', () => {
  assert.throws(() => assertStockIdentityMatches({
    itemNo: 'FORMWORK-084', materialNo: 'FORMWORK-052',
  }, 'FORMWORK-084'), /ข้อมูลสต็อกมีรหัสขัดกัน/);
});
