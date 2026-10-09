import { describe, expect, it } from 'vitest';
import {
  canSwitchToSimple, collapseToSimple, defaultAccountName, pickPrimaryRow, planAccountSave, primaryAccount,
  resolveAccountMode, rowsFromAccounts, validateAccountRows,
} from '../../src/lib/accountMode.js';
import { UNALLOCATED_ID, splitPayment } from '../../src/lib/allocation.js';
import { paymentAllocations } from '../../src/lib/selectors.js';

const acc = (id, name, extra = {}) => ({
  id, name, order: 1, openingBalance: 0, active: true, note: '', createdBy: 'a@x.id', createdAt: '2026-07-01', ...extra,
});
const fresh = (name, extra = {}) => ({ key: `new-${name}`, name, openingBalance: '', note: '', active: true, ...extra });

describe('resolveAccountMode', () => {
  it('memakai mode tersimpan bila valid', () => {
    expect(resolveAccountMode({ account_mode: 'multi' }, [acc('a', 'A')])).toBe('multi');
    expect(resolveAccountMode({ account_mode: 'simple' }, [acc('a', 'A'), acc('b', 'B')])).toBe('simple');
  });
  it('nilai rusak atau kosong: Multi bila akun > 1, selain itu Sederhana', () => {
    expect(resolveAccountMode({ account_mode: 'ngawur' }, [])).toBe('simple');
    expect(resolveAccountMode({}, [acc('a', 'A')])).toBe('simple');
    expect(resolveAccountMode({}, [acc('a', 'A'), acc('b', 'B')])).toBe('multi');
    expect(resolveAccountMode(undefined, [])).toBe('simple');
  });
});

describe('defaultAccountName / primaryAccount', () => {
  it('menggabungkan "Iuran " dengan nama kas', () => {
    expect(defaultAccountName('Kas RT 05')).toBe('Iuran Kas RT 05');
    expect(defaultAccountName('  Kelas XII  ')).toBe('Iuran Kelas XII');
    expect(defaultAccountName('')).toBe('Iuran');
  });
  it('akun utama = aktif pertama, atau pertama bila semua nonaktif', () => {
    const list = [acc('a', 'A', { active: false }), acc('b', 'B'), acc('c', 'C')];
    expect(primaryAccount(list).id).toBe('b');
    expect(primaryAccount([acc('a', 'A', { active: false })]).id).toBe('a');
    expect(primaryAccount([])).toBeNull();
  });
});

describe('tukar mode', () => {
  it('ke Sederhana hanya boleh bila paling banyak satu baris aktif', () => {
    const rows = rowsFromAccounts([acc('a', 'A'), acc('b', 'B')]);
    expect(canSwitchToSimple(rows)).toBe(false);
    rows[1].active = false;
    expect(canSwitchToSimple(rows)).toBe(true);
  });
  it('baris baru yang masih kosong tidak dihitung', () => {
    expect(canSwitchToSimple([...rowsFromAccounts([acc('a', 'A')]), fresh('')])).toBe(true);
    expect(canSwitchToSimple([...rowsFromAccounts([acc('a', 'A')]), fresh('Baru')])).toBe(false);
  });
  it('collapseToSimple mempertahankan semua akun tersimpan dan membuang baris baru selain yang utama', () => {
    const saved = rowsFromAccounts([acc('a', 'A', { active: false }), acc('b', 'B')]);
    // akun tersimpan "b" sudah aktif, jadi baris baru dibuang
    expect(collapseToSimple([...saved, fresh('Baru', { active: false })]).map((r) => r.id)).toEqual(['a', 'b']);
    expect(pickPrimaryRow(saved).id).toBe('b');
    expect(collapseToSimple([fresh('Satu')]).map((r) => r.name)).toEqual(['Satu']);
  });
});

describe('validateAccountRows', () => {
  it('Sederhana: nama utama wajib dan tidak boleh ada akun aktif lain', () => {
    expect(validateAccountRows([fresh('Iuran Kas')], 'simple')).toBeNull();
    expect(validateAccountRows([fresh('  ')], 'simple')).toMatch(/wajib/);
    expect(validateAccountRows([], 'simple')).toMatch(/wajib/);
    const two = rowsFromAccounts([acc('a', 'A'), acc('b', 'B')]);
    expect(validateAccountRows(two, 'simple')).toMatch(/satu akun aktif/);
    two[1].active = false;
    expect(validateAccountRows(two, 'simple')).toBeNull();
  });
  it('Multi: minimal satu akun, akun tersimpan tidak boleh tanpa nama, baris baru kosong diabaikan', () => {
    expect(validateAccountRows([fresh('')], 'multi')).toMatch(/minimal satu/i);
    expect(validateAccountRows([fresh('A'), fresh('')], 'multi')).toBeNull();
    const rows = rowsFromAccounts([acc('a', 'A')]);
    rows[0].name = ' ';
    expect(validateAccountRows(rows, 'multi')).toMatch(/wajib/);
  });
});

describe('planAccountSave', () => {
  it('buku baru Sederhana: satu akun baru berurutan 1', () => {
    const plan = planAccountSave([fresh(' Iuran Kas RT ', { openingBalance: 25000 })], [], 'simple');
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toAdd).toEqual([{ name: 'Iuran Kas RT', openingBalance: 25000, note: '', active: true, order: 1 }]);
  });
  it('saldo awal kosong menjadi 0 dan catatan dipangkas', () => {
    const [added] = planAccountSave([fresh('A', { note: '  catatan ' })], [], 'multi').toAdd;
    expect(added).toMatchObject({ openingBalance: 0, note: 'catatan' });
  });
  it('Multi: urutan mengikuti baris, hanya akun yang berubah masuk toUpdate, baris baru kosong diabaikan', () => {
    const accounts = [acc('a', 'A', { order: 1 }), acc('b', 'B', { order: 2 })];
    const rows = rowsFromAccounts(accounts).reverse(); // tukar urutan
    rows.push(fresh('C'), fresh(''));
    const plan = planAccountSave(rows, accounts, 'multi');
    expect(plan.toUpdate.map((a) => [a.id, a.order])).toEqual([['b', 1], ['a', 2]]);
    expect(plan.toUpdate[0].createdBy).toBe('a@x.id'); // data audit terbawa
    expect(plan.toAdd.map((a) => [a.name, a.order])).toEqual([['C', 3]]);
  });
  it('tanpa perubahan: tidak ada operasi tulis', () => {
    const accounts = [acc('a', 'A', { order: 1 }), acc('b', 'B', { order: 2 })];
    expect(planAccountSave(rowsFromAccounts(accounts), accounts, 'multi')).toEqual({ toUpdate: [], toAdd: [] });
  });
  it('Sederhana: akun utama dipaksa aktif, akun nonaktif lama tetap, baris baru lain dibuang', () => {
    const accounts = [acc('a', 'A', { order: 1, active: false })];
    const rows = [...rowsFromAccounts(accounts), fresh('Tak terpakai', { active: false })];
    const plan = planAccountSave(rows, accounts, 'simple');
    expect(plan.toAdd).toEqual([]);
    expect(plan.toUpdate).toMatchObject([{ id: 'a', active: true }]);
  });
  it('Sederhana dari buku Multi: akun nonaktif tidak disentuh dan urutannya tetap', () => {
    const accounts = [acc('a', 'A', { order: 1, active: false }), acc('b', 'B', { order: 2 })];
    expect(planAccountSave(rowsFromAccounts(accounts), accounts, 'simple')).toEqual({ toUpdate: [], toAdd: [] });
  });
  it('menolak draf tidak valid dan akun yang sudah tidak ada', () => {
    expect(() => planAccountSave([fresh('')], [], 'simple')).toThrow(/wajib/);
    expect(() => planAccountSave(rowsFromAccounts([acc('x', 'X')]), [], 'multi')).toThrow(/tidak ada/);
  });
});

describe('paymentAllocations', () => {
  const data = {
    accounts: [acc('a', 'A', { active: false }), acc('b', 'B', { order: 2 })],
    allocations: [{ periodId: 'p1', accountId: 'b', amount: 100000 }],
  };
  it('Sederhana: seluruh pembayaran, termasuk kelebihan, masuk akun tunggal (bukan Umum)', () => {
    const allocs = paymentAllocations(data, 'p1', 'simple');
    expect(splitPayment(150000, allocs)).toEqual({ b: 150000 });
    expect(splitPayment(60000, allocs, { b: 100000 })).toEqual({ b: 60000 });
  });
  it('Sederhana tanpa akun: kosong (semua ke Umum)', () => {
    expect(splitPayment(1000, paymentAllocations({ accounts: [], allocations: [] }, 'p1', 'simple'))).toEqual({ [UNALLOCATED_ID]: 1000 });
  });
  it('Multi: memakai alokasi periode, kelebihan ke Umum', () => {
    const allocs = paymentAllocations(data, 'p1', 'multi');
    expect(allocs).toEqual([{ accountId: 'b', amount: 100000 }]);
    expect(splitPayment(150000, allocs)).toEqual({ b: 100000, [UNALLOCATED_ID]: 50000 });
  });
});
