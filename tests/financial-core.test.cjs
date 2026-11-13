const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const coreMatch = html.match(/<script id="financial-core">([\s\S]*?)<\/script>/);
assert.ok(coreMatch, 'financial core script must exist');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(coreMatch[1], context);
const Core = context.CalculatorCore;

function approx(actual, expected, tolerance, message) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        (message || 'values differ') + ': expected ' + expected + ', got ' + actual
    );
}

function baseParams(overrides = {}) {
    const params = {
        model: 'investor',
        investorAnalysisMode: 'single',
        investors: [],
        buyPrice: 10_000_000,
        plannedExpenses: 2_000_000,
        actualExpenses: 2_000_000,
        dealDays: 365,
        investorAmount: 6_000_000,
        profitMultiplierPercent: 60,
        downPayment: 0,
        loanAmount: 0,
        mortgageRate: 0,
        mortgageYears: 25,
        mortgageExtraCosts: 0,
        tax: {
            manual: false,
            manualAmount: 0,
            ownerType: 'ip',
            dkpBuyPrice: 10_000_000,
            dkpSellPrice: null,
            deductibleType: 'percent',
            deductibleValue: 100
        }
    };
    return {
        ...params,
        ...overrides,
        tax: { ...params.tax, ...(overrides.tax || {}) }
    };
}

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test('контрольный обратный расчет дает 5% инвестору', () => {
    const params = baseParams();
    const solved = Core.solveSalePrice(params, 5);
    assert.equal(solved.ok, true);
    approx(solved.salePrice, 13_176_470.588235294, 0.01, 'sale price');
    approx(solved.deal.plannedBudget, 12_000_000, 0.001, 'planned budget');
    approx(solved.deal.investorShare, 0.30, 1e-12, 'investor share');
    approx(solved.deal.tax, 176_470.5882352941, 0.01, 'tax');
    approx(solved.deal.netProfit, 1_000_000, 0.01, 'project profit');
    approx(solved.deal.investorProfit, 300_000, 0.01, 'investor profit');
    approx(solved.deal.investorYield, 5, 1e-10, 'investor yield');

    const direct = Core.calculateDeal(params, solved.salePrice);
    approx(direct.investorYield, 5, 0.0000001, 'round-trip yield');
});

test('обратный расчет 0% возвращает цену безубыточности проекта', () => {
    const params = baseParams();
    const solved = Core.solveSalePrice(params, 0);
    assert.equal(solved.ok, true);
    approx(solved.salePrice, 12_000_000, 0.01, 'break-even sale price');
    approx(solved.deal.netProfit, 0, 0.01, 'break-even project profit');
    assert.equal(solved.deal.investorProfit, 0);
    assert.equal(solved.deal.investorYield, 0);
});

test('индивидуальные условия 50/50, 55/45 и 60/40 считаются отдельно', () => {
    [
        [3_000_000, 50],
        [4_500_000, 55],
        [6_000_000, 60]
    ].forEach(([amount, multiplier]) => {
        const params = baseParams({ investorAmount: amount, profitMultiplierPercent: multiplier });
        approx(
            Core.investorShare(params),
            (amount / 12_000_000) * (multiplier / 100),
            1e-12
        );
    });
});

test('экономия и перерасход не пересчитывают долю инвестора', () => {
    const economy = Core.calculateDeal(baseParams({ actualExpenses: 1_500_000 }), 14_000_000);
    const overrun = Core.calculateDeal(baseParams({ actualExpenses: 2_500_000 }), 14_000_000);
    approx(economy.investorShare, overrun.investorShare, 1e-12);
    assert.equal(economy.expenseVariance, 500_000);
    assert.equal(overrun.expenseVariance, -500_000);
    assert.ok(economy.netProfit > overrun.netProfit);
});

test('ручной налог, нулевая база, физлицо и фиксированный ДКП согласованы', () => {
    const manual = Core.calculateDeal(baseParams({
        tax: { manual: true, manualAmount: 123_456 }
    }), 13_000_000);
    assert.equal(manual.tax, 123_456);

    const zeroBase = Core.calculateDeal(baseParams(), 11_000_000);
    assert.equal(zeroBase.tax, 0);

    const fiz = Core.calculateDeal(baseParams({
        tax: { ownerType: 'fiz' }
    }), 13_000_000);
    assert.equal(fiz.tax, 450_000);

    const fixedDkpParams = baseParams({
        tax: { dkpSellPrice: 12_500_000 }
    });
    const low = Core.calculateDeal(fixedDkpParams, 13_000_000);
    const high = Core.calculateDeal(fixedDkpParams, 14_000_000);
    assert.equal(low.tax, high.tax);
});

test('семь сценариев с шагом 300 000 ₽', () => {
    const scenarios = Core.buildScenarios(22_000_000, 300_000);
    assert.deepEqual(
        Array.from(scenarios, item => item.price),
        [21_100_000, 21_400_000, 21_700_000, 22_000_000, 22_300_000, 22_600_000, 22_900_000]
    );
    assert.equal(scenarios[3].name, 'Базовая цена');
});

test('семь сценариев с шагом 500 000 ₽', () => {
    const scenarios = Core.buildScenarios(22_000_000, 500_000);
    assert.deepEqual(
        Array.from(scenarios, item => item.price),
        [20_500_000, 21_000_000, 21_500_000, 22_000_000, 22_500_000, 23_000_000, 23_500_000]
    );
});

test('нулевые и отрицательные цены сценариев помечаются недопустимыми', () => {
    const scenarios = Core.buildScenarios(500_000, 300_000);
    assert.deepEqual(
        Array.from(scenarios, item => item.isValid),
        [false, false, true, true, true, true, true]
    );
});

test('подробный и укрупненный ввод инвесторов дают одинаковый результат', () => {
    const common = {
        model: 'investor',
        investorAnalysisMode: 'all',
        buyPrice: 18_000_000,
        plannedExpenses: 2_000_000,
        actualExpenses: 2_000_000,
        dealDays: 365,
        investorAmount: 4_000_000,
        profitMultiplierPercent: 60,
        downPayment: 0,
        loanAmount: 0,
        mortgageRate: 0,
        mortgageYears: 25,
        mortgageExtraCosts: 0,
        tax: {
            manual: true,
            manualAmount: 0,
            ownerType: 'ip',
            dkpBuyPrice: 18_000_000,
            dkpSellPrice: null,
            deductibleType: 'percent',
            deductibleValue: 100
        }
    };
    const detailed = Core.calculateDeal({
        ...common,
        investors: [
            { amount: 4_000_000, profitPercent: 60 },
            { amount: 6_000_000, profitPercent: 70 }
        ]
    }, 23_000_000);
    const aggregated = Core.calculateDeal({
        ...common,
        investors: [{ amount: 10_000_000, profitPercent: 66 }]
    }, 23_000_000);

    assert.equal(detailed.netProfit, 3_000_000);
    assert.equal(detailed.investorPool.totalLoan, 10_000_000);
    assert.equal(detailed.investorPool.weightedProfitPercent, 66);
    approx(detailed.investorPool.totalShare, 0.33, 1e-12);
    approx(detailed.investorPool.investorsProfit, 990_000, 1e-8);
    approx(detailed.investorPool.annualYield, 9.9, 1e-12);
    assert.notEqual(detailed.investorPool.annualYield, (9 + 10.5) / 2);
    approx(detailed.investorPool.ownerProfit, 2_010_000, 1e-8);
    approx(aggregated.investorPool.totalShare, detailed.investorPool.totalShare, 1e-12);
    approx(aggregated.investorPool.investorsProfit, detailed.investorPool.investorsProfit, 1e-8);
    approx(aggregated.investorPool.annualYield, detailed.investorPool.annualYield, 1e-12);
    approx(aggregated.investorPool.ownerProfit, detailed.investorPool.ownerProfit, 1e-8);
});

test('одинаковые условия можно укрупнить одной строкой', () => {
    const params = baseParams({
        investorAnalysisMode: 'all',
        investors: [
            { amount: 2_000_000, profitPercent: 60 },
            { amount: 4_000_000, profitPercent: 60 }
        ]
    });
    const detailed = Core.calculateDeal(params, 14_000_000);
    const aggregated = Core.calculateDeal({
        ...params,
        investors: [{ amount: 6_000_000, profitPercent: 60 }]
    }, 14_000_000);
    approx(detailed.investorPool.investorsProfit, aggregated.investorPool.investorsProfit, 1e-8);
});

test('прибыль проекта равна сумме прибыли инвесторов и собственника', () => {
    const params = baseParams({
        investorAnalysisMode: 'all',
        investors: [
            { amount: 3_000_000, profitPercent: 55 },
            { amount: 3_000_000, profitPercent: 70 }
        ]
    });
    [9_000_000, 12_000_000, 14_000_000].forEach(salePrice => {
        const deal = Core.calculateDeal(params, salePrice);
        approx(
            deal.investorPool.investorsProfit + deal.investorPool.ownerProfit,
            deal.netProfit,
            1e-8
        );
        if (deal.netProfit <= 0) assert.equal(deal.investorPool.investorsProfit, 0);
        if (deal.netProfit <= 0) assert.equal(deal.investorPool.annualYield, 0);
    });
});

test('совокупная доходность учитывает срок сделки и сумму займов', () => {
    const params = baseParams({
        investorAnalysisMode: 'all',
        investors: [{ amount: 6_000_000, profitPercent: 60 }],
        dealDays: 180
    });
    const deal = Core.calculateDeal(params, 14_000_000);
    const expected = (deal.investorPool.investorsProfit / 6_000_000) * (365 / 180) * 100;
    approx(deal.investorPool.annualYield, expected, 1e-12);
});

test('валидация ограничивает сумму займов и совокупную долю', () => {
    const overBudget = baseParams({
        investorAnalysisMode: 'all',
        investors: [{ amount: 13_000_000, profitPercent: 60 }]
    });
    assert.ok(Core.validate(overBudget, { salePrice: 14_000_000 }).some(error => error.includes('плановый бюджет')));

    const overShare = baseParams({
        investorAnalysisMode: 'all',
        investors: [
            { amount: 7_000_000, profitPercent: 100 },
            { amount: 5_500_000, profitPercent: 100 }
        ]
    });
    assert.ok(Core.validate(overShare, { salePrice: 14_000_000 }).some(error => error.includes('100%')));
});

test('обратная цена является базой сценариев и совпадает с основным расчетом', () => {
    const params = baseParams();
    const solved = Core.solveSalePrice(params, 5);
    const scenarios = Core.buildScenarios(solved.salePrice, 300_000);
    const base = scenarios.find(item => item.isBase);
    const baseDeal = Core.calculateDeal(params, base.price);
    approx(base.price, solved.salePrice, 1e-9);
    approx(baseDeal.netProfit, solved.deal.netProfit, 1e-8);
    approx(baseDeal.investorYield, solved.deal.investorYield, 1e-10);
});

test('некорректные данные отклоняются без NaN и Infinity', () => {
    assert.ok(Core.validate(baseParams({ dealDays: 0 }), { salePrice: 13_000_000 }).length);
    assert.ok(Core.validate(baseParams({ investorAmount: 0 }), { salePrice: 13_000_000 }).length);
    assert.ok(Core.validate(baseParams({ buyPrice: 0, plannedExpenses: 0 }), { salePrice: 13_000_000 }).length);
    assert.ok(Core.validate(baseParams({ actualExpenses: -1 }), { salePrice: 13_000_000 }).length);
    assert.ok(Core.validate(baseParams({ investorAmount: 13_000_000 }), { salePrice: 13_000_000 }).length);
});

test('убыток проекта не уменьшает основной долг и не создает убыток инвестора', () => {
    const loss = Core.calculateDeal(baseParams(), 9_000_000);
    assert.equal(loss.netProfit, -3_000_000);
    assert.equal(loss.investorPrincipalRepayment, 6_000_000);
    assert.equal(loss.investorProfit, 0);
    assert.equal(loss.investorYield, 0);
});

test('безубыточный проект дает инвестору нулевую прибыль и доходность', () => {
    const breakEven = Core.calculateDeal(baseParams(), 12_000_000);
    assert.equal(breakEven.netProfit, 0);
    assert.equal(breakEven.investorPrincipalRepayment, 6_000_000);
    assert.equal(breakEven.investorProfit, 0);
    assert.equal(breakEven.investorYield, 0);
});

test('при переходе от убытка к прибыли выплаты инвестору начинаются только выше нуля', () => {
    const loss = Core.calculateDeal(baseParams(), 11_900_000);
    const breakEven = Core.calculateDeal(baseParams(), 12_000_000);
    const profit = Core.calculateDeal(baseParams(), 12_100_000);

    assert.equal(loss.netProfit, -100_000);
    assert.equal(loss.investorProfit, 0);
    assert.equal(breakEven.netProfit, 0);
    assert.equal(breakEven.investorProfit, 0);
    assert.equal(profit.netProfit, 85_000);
    assert.equal(profit.investorProfit, 25_500);
    approx(profit.investorYield, 0.425, 1e-12);
});

test('аннуитет, проценты, остаток долга и ROE не учитывают тело кредита дважды', () => {
    const params = baseParams({
        model: 'mortgage',
        investorAmount: 0,
        profitMultiplierPercent: 0,
        downPayment: 2_000_000,
        loanAmount: 8_000_000,
        mortgageRate: 18,
        mortgageYears: 20,
        mortgageExtraCosts: 80_000,
        dealDays: 180
    });
    const deal = Core.calculateDeal(params, 14_500_000);
    assert.ok(deal.mortgage.monthlyPayment > 0);
    assert.ok(deal.mortgage.interestPaid > 0);
    assert.ok(deal.mortgage.outstandingPrincipal < params.loanAmount);
    assert.ok(deal.mortgage.outstandingPrincipal > 0);
    approx(
        deal.salePrice - deal.mortgage.outstandingPrincipal - deal.mortgage.ownCapital - deal.tax,
        deal.netProfit,
        0.01,
        'cash-flow identity'
    );

    const solved = Core.solveSalePrice(params, 25);
    assert.equal(solved.ok, true);
    approx(solved.deal.roe, 25, 1e-8);
});

let failed = 0;
for (const item of tests) {
    try {
        item.fn();
        console.log('✓ ' + item.name);
    } catch (error) {
        failed += 1;
        console.error('✗ ' + item.name);
        console.error(error.stack);
    }
}

console.log('\n' + (tests.length - failed) + '/' + tests.length + ' tests passed');
if (failed) process.exit(1);
