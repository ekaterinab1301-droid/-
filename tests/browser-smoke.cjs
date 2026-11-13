const assert = require('node:assert/strict');
const fs = require('node:fs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function createPage(url) {
    const created = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    if (!created.ok) throw new Error('Cannot create Chrome tab: ' + created.status);
    const target = await created.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const pageErrors = [];
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
            const details = message.params.exceptionDetails;
            pageErrors.push(details.exception?.description || details.text || 'Unhandled browser exception');
        }
        if (!message.id || !pending.has(message.id)) return;
        const callbacks = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) callbacks.reject(new Error(message.error.message));
        else callbacks.resolve(message.result);
    });

    function send(method, params = {}) {
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }

    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
        }
        return result.result.value;
    }

    return { ws, send, evaluate, pageErrors };
}

function inspectInitial() {
    return {
        title: document.title,
        hasCore: typeof CalculatorCore === 'object',
        scenarioButtons: [
            document.getElementById('btnScen300')?.textContent.trim(),
            document.getElementById('btnScen500')?.textContent.trim()
        ],
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
    };
}

function runRoundTrip() {
    const set = (id, value) => { document.getElementById(id).value = value; };
    switchFinModel('investor');
    switchMode(2);
    set('dynamicInput', '5');
    set('buyPrice', '10000000');
    set('planRenovation', '2000000');
    set('renovation', '2000000');
    set('dealDays', '365');
    set('investorAmount', '6000000');
    set('profitMultiplier', '60');
    set('taxDeductibleValue', '100');
    document.getElementById('manualTaxToggle').checked = false;
    document.getElementById('dkpDiffToggle').checked = false;
    document.querySelector('input[name=ownerType][value=ip]').checked = true;
    updateInvestorShare();
    const ok = calculateROI(true);
    const salePrice = lastCalculation.salePrice;
    const reverseYield = lastCalculation.deal.investorYield;
    const reverseBase = lastCalculation.scenarios.find(item => item.scenario.isBase);
    const reverseMainProfit = lastCalculation.deal.netProfit;

    switchMode(1);
    set('dynamicInput', String(salePrice));
    calculateROI(true);
    const directBase = lastCalculation.scenarios.find(item => item.scenario.isBase);
    const directYield = lastCalculation.deal.investorYield;
    const directMainProfit = lastCalculation.deal.netProfit;
    const directBaseProfit = directBase.data.netProfit;
    const directBaseYield = directBase.data.investorYield;
    switchMode(2);
    set('dynamicInput', '0');
    calculateROI(true);
    const breakEvenSalePrice = lastCalculation.salePrice;
    const breakEvenProfit = lastCalculation.deal.netProfit;
    switchMode(1);
    set('dynamicInput', String(salePrice));
    calculateROI(true);
    return {
        ok,
        salePrice,
        reverseYield,
        directYield,
        breakEvenSalePrice,
        breakEvenProfit,
        reverseBaseProfit: reverseBase.data.netProfit,
        reverseMainProfit,
        directBaseProfit,
        directMainProfit,
        directBaseYield,
        scenarioPrices: lastCalculation.scenarios.map(item => Math.round(item.scenario.price)),
        resultText: document.getElementById('resCard4').textContent,
        hasNaN: document.getElementById('results').textContent.includes('NaN')
            || document.getElementById('results').textContent.includes('Infinity')
    };
}

function configureAllInvestors() {
    const set = (id, value) => { document.getElementById(id).value = value; };
    switchFinModel('investor');
    switchMode(1);
    set('dynamicInput', '23000000');
    set('buyPrice', '18000000');
    set('planRenovation', '2000000');
    set('renovation', '2000000');
    set('dealDays', '365');
    set('investorAmount', '4000000');
    set('profitMultiplier', '60');
    document.getElementById('manualTaxToggle').checked = true;
    set('manualTaxInput', '0');
    switchInvestorScenarioView('all');
    const importedHintVisible = document.getElementById('investorPoolRows').textContent.includes('перенесён из режима');
    document.getElementById('investorPoolRows').innerHTML = '';
    addInvestorPoolRow(4_000_000, 60);
    addInvestorPoolRow(6_000_000, 70);
    calculateROI(true);
    const detailed = {
        totalLoan: lastCalculation.deal.investorPool.totalLoan,
        weightedPercent: lastCalculation.deal.investorPool.weightedProfitPercent,
        totalShare: lastCalculation.deal.investorPool.totalShare,
        investorsProfit: lastCalculation.deal.investorPool.investorsProfit,
        annualYield: lastCalculation.deal.investorPool.annualYield,
        ownerProfit: lastCalculation.deal.investorPool.ownerProfit,
        baseProfit: lastCalculation.scenarios.find(item => item.scenario.isBase).data.netProfit,
        card3: document.getElementById('resCard3').textContent,
        card3Secondary: document.getElementById('resCard3Secondary').textContent,
        card4: document.getElementById('resCard4').textContent,
        header4: document.getElementById('colHeaderProjectYield').textContent,
        header5: document.getElementById('colHeaderInvProfit').textContent,
        taxLineVisible: document.getElementById('scenarioTableBody').textContent.includes('Налог'),
        scenarioYieldVisible: document.getElementById('scenarioTableBody').textContent.includes('9.90% годовых'),
        importedHintVisible
    };

    document.getElementById('investorPoolRows').innerHTML = '';
    addInvestorPoolRow(10_000_000, 66);
    calculateROI(true);
    return {
        detailed,
        aggregated: {
            totalShare: lastCalculation.deal.investorPool.totalShare,
            investorsProfit: lastCalculation.deal.investorPool.investorsProfit,
            ownerProfit: lastCalculation.deal.investorPool.ownerProfit
        }
    };
}

function testInvestorPoolAutoRecovery() {
    const amountInput = document.querySelector('.investor-pool-amount');
    amountInput.value = '25000000';
    investorPoolChanged();
    const invalid = {
        errorVisible: !document.getElementById('investorPoolError').classList.contains('hidden'),
        resultsVisible: !document.getElementById('results').classList.contains('hidden'),
        staleWarningVisible: !document.getElementById('calculationStaleWarning').classList.contains('hidden'),
        pdfDisabled: document.getElementById('btnSavePdf').disabled,
        financialOutputsDimmed: document.querySelectorAll('.financial-output.opacity-40').length > 0
    };

    amountInput.value = '10000000';
    investorPoolChanged();
    return {
        invalid,
        errorHiddenAfterFix: document.getElementById('investorPoolError').classList.contains('hidden'),
        staleWarningHiddenAfterFix: document.getElementById('calculationStaleWarning').classList.contains('hidden'),
        pdfEnabledAfterFix: !document.getElementById('btnSavePdf').disabled,
        resultsVisibleAfterFix: !document.getElementById('results').classList.contains('hidden'),
        totalLoanAfterFix: lastCalculation && lastCalculation.deal.investorPool.totalLoan
    };
}

function prepareThreeInvestorRegression() {
    const rows = document.getElementById('investorPoolRows');
    rows.innerHTML = '';
    addInvestorPoolRow(4_000_000, 60);
    addInvestorPoolRow(6_000_000, 70);
    calculateROI(true);
    addInvestorPoolRow();
    const thirdAmount = document.querySelectorAll('.investor-pool-amount')[2];
    const thirdPercent = document.querySelectorAll('.investor-pool-percent')[2];
    thirdAmount.value = '1000000';
    thirdAmount.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '1000000' }));
    thirdPercent.value = '';
    thirdPercent.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    thirdPercent.focus();
    document.getElementById('allInvestorsPanel').scrollIntoView({ block: 'center' });
    return {
        scrollY: window.scrollY,
        baseProfit: lastCalculation.deal.investorPool.investorsProfit,
        invalidatedOnAdd: !isCalculated,
        pdfDisabledOnAdd: document.getElementById('btnSavePdf').disabled,
        staleWarningVisibleOnAdd: !document.getElementById('calculationStaleWarning').classList.contains('hidden')
    };
}

function inspectInvalidThirdInvestor() {
    const rows = Array.from(document.querySelectorAll('.investor-pool-row'));
    const thirdError = rows[2].querySelector('.investor-row-error');
    return {
        scrollY: window.scrollY,
        rowCount: rows.length,
        firstAmounts: rows.slice(0, 2).map(row => row.querySelector('.investor-pool-amount').value),
        firstPercents: rows.slice(0, 2).map(row => row.querySelector('.investor-pool-percent').value),
        thirdAmount: rows[2].querySelector('.investor-pool-amount').value,
        thirdPercent: rows[2].querySelector('.investor-pool-percent').value,
        rowErrorVisible: !thirdError.classList.contains('hidden'),
        rowErrorText: thirdError.textContent,
        resultsVisible: !document.getElementById('results').classList.contains('hidden'),
        panelVisible: !document.getElementById('allInvestorsPanel').classList.contains('hidden'),
        staleWarningVisible: !document.getElementById('calculationStaleWarning').classList.contains('hidden'),
        globalErrorHidden: document.getElementById('errorMessage').classList.contains('hidden'),
        pdfDisabled: document.getElementById('btnSavePdf').disabled,
        financialOutputsDimmed: document.querySelectorAll('.financial-output.opacity-40').length > 0,
        isCalculated
    };
}

function fixThirdInvestor() {
    const thirdPercent = document.querySelectorAll('.investor-pool-percent')[2];
    thirdPercent.value = '60';
    thirdPercent.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '60' }));
    const rows = Array.from(document.querySelectorAll('.investor-pool-row'));
    return {
        rowCount: rows.length,
        firstAmounts: rows.slice(0, 2).map(row => row.querySelector('.investor-pool-amount').value),
        firstPercents: rows.slice(0, 2).map(row => row.querySelector('.investor-pool-percent').value),
        rowErrorHidden: rows[2].querySelector('.investor-row-error').classList.contains('hidden'),
        staleWarningHidden: document.getElementById('calculationStaleWarning').classList.contains('hidden'),
        pdfEnabled: !document.getElementById('btnSavePdf').disabled,
        financialOutputsCurrent: document.querySelectorAll('.financial-output.opacity-40').length === 0,
        totalLoan: lastCalculation && lastCalculation.deal.investorPool.totalLoan,
        scenarioCount: lastCalculation && lastCalculation.scenarios.length,
        isCalculated
    };
}

function inspectLayout() {
    const scroller = document.querySelector('#scenarioSection .overflow-x-auto');
    return {
        viewport: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        scenarioClient: scroller.clientWidth,
        scenarioScroll: scroller.scrollWidth
    };
}

async function inspectPdf() {
    window.html2pdf = function() {
        return {
            set() { return this; },
            from(element) {
                const table = element.querySelector('table[style*=table-layout]');
                const rect = element.getBoundingClientRect();
                window.__pdfSnapshot = {
                    html: element.outerHTML,
                    rowCount: table.querySelectorAll('tbody tr').length,
                    firstRowText: table.querySelector('tbody tr').textContent,
                    rootLeft: rect.left,
                    rootWidth: rect.width,
                    rootScrollWidth: element.scrollWidth,
                    windowScrollX: window.scrollX,
                    tableClientWidth: table.clientWidth,
                    tableScrollWidth: table.scrollWidth
                };
                return this;
            },
            save() { return Promise.resolve(); }
        };
    };
    exportCalculationToPDF();
    await new Promise(resolve => setTimeout(resolve, 500));
    return window.__pdfSnapshot;
}

(async () => {
    const page = await createPage('http://127.0.0.1:4173/index.html');
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1800,
        deviceScaleFactor: 1,
        mobile: false
    });
    await delay(3000);

    const initial = await page.evaluate('(' + inspectInitial.toString() + ')()');
    assert.equal(initial.title, 'Калькулятор инвестиционной доходности');
    assert.equal(initial.hasCore, true);
    assert.deepEqual(initial.scenarioButtons, ['Шаг 300 000 ₽', 'Шаг 500 000 ₽']);
    assert.ok(initial.pageWidth <= initial.viewportWidth);

    const reverse = await page.evaluate('(' + runRoundTrip.toString() + ')()');
    assert.equal(reverse.ok, true);
    assert.ok(Math.abs(reverse.salePrice - 13_176_470.588235294) < 0.01);
    assert.ok(Math.abs(reverse.reverseYield - 5) < 0.000001);
    assert.ok(Math.abs(reverse.directYield - 5) < 0.000001);
    assert.ok(Math.abs(reverse.breakEvenSalePrice - 12_000_000) < 0.01);
    assert.ok(Math.abs(reverse.breakEvenProfit) < 0.01);
    assert.ok(Math.abs(reverse.reverseBaseProfit - reverse.reverseMainProfit) < 0.01);
    assert.ok(Math.abs(reverse.directBaseProfit - reverse.directMainProfit) < 0.01);
    assert.ok(Math.abs(reverse.directBaseYield - reverse.directYield) < 1e-10);
    assert.equal(reverse.resultText, '5.00% годовых');
    assert.equal(reverse.hasNaN, false);
    assert.deepEqual(reverse.scenarioPrices, [
        12_276_471, 12_576_471, 12_876_471, 13_176_471, 13_476_471, 13_776_471, 14_076_471
    ]);

    await page.evaluate('switchScenarioMode(500000)');
    const step500 = await page.evaluate('lastCalculation.scenarios.map(item => Math.round(item.scenario.price))');
    assert.deepEqual(step500, [
        11_676_471, 12_176_471, 12_676_471, 13_176_471, 13_676_471, 14_176_471, 14_676_471
    ]);
    const lossScenario = await page.evaluate('(() => { const item = lastCalculation.scenarios[0].data; return { netProfit: item.netProfit, investorProfit: item.investorProfit, investorYield: item.investorYield }; })()');
    assert.ok(lossScenario.netProfit < 0);
    assert.equal(lossScenario.investorProfit, 0);
    assert.equal(lossScenario.investorYield, 0);

    const invalidScenarios = await page.evaluate('(() => { document.getElementById("dynamicInput").value = "500000"; calculateROI(true); return { invalidCount: lastCalculation.scenarios.filter(item => !item.scenario.isValid).length, text: document.getElementById("scenarioTableBody").textContent }; })()');
    assert.equal(invalidScenarios.invalidCount, 3);
    assert.ok(invalidScenarios.text.includes('Недопустимая цена'));
    await page.evaluate('document.getElementById("dynamicInput").value = "13176470.588235294"; calculateROI(true)');

    for (const width of [375, 390, 430, 1440]) {
        await page.send('Emulation.setDeviceMetricsOverride', {
            width,
            height: width === 1440 ? 1800 : 1200,
            deviceScaleFactor: 1,
            mobile: width !== 1440
        });
        await delay(200);
        const layout = await page.evaluate('(' + inspectLayout.toString() + ')()');
        assert.ok(layout.pageWidth <= layout.viewport, 'page overflow at ' + width + ': ' + JSON.stringify(layout));
        if (width < 500) {
            assert.ok(layout.scenarioScroll > layout.scenarioClient, 'scenario table should scroll at ' + width);
        }
        const shot = await page.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false
        });
        fs.writeFileSync('/tmp/flipping-after-' + width + '.png', Buffer.from(shot.data, 'base64'));
    }

    const downloadPath = '/tmp/flipping-pdf-downloads';
    fs.rmSync(downloadPath, { recursive: true, force: true });
    fs.mkdirSync(downloadPath, { recursive: true });
    await page.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath,
        eventsEnabled: true
    });
    const pdfLibraryLoaded = await page.evaluate('typeof html2pdf === "function"');
    assert.equal(pdfLibraryLoaded, true, 'html2pdf library should load');
    await page.evaluate('document.getElementById("pdfVariantTitle").value = "Codex PDF Single"; exportCalculationToPDF(); true');
    await delay(6000);

    const allInvestors = await page.evaluate('(' + configureAllInvestors.toString() + ')()');
    assert.equal(allInvestors.detailed.totalLoan, 10_000_000);
    assert.equal(allInvestors.detailed.weightedPercent, 66);
    assert.ok(Math.abs(allInvestors.detailed.totalShare - 0.33) < 1e-12);
    assert.ok(Math.abs(allInvestors.detailed.investorsProfit - 990_000) < 1e-8);
    assert.ok(Math.abs(allInvestors.detailed.annualYield - 9.9) < 1e-12);
    assert.ok(Math.abs(allInvestors.detailed.ownerProfit - 2_010_000) < 1e-8);
    assert.equal(allInvestors.detailed.baseProfit, 3_000_000);
    assert.ok(allInvestors.detailed.card3.replace(/\s/g, '').includes('990000₽'));
    assert.ok(allInvestors.detailed.card3Secondary.includes('9.90% годовых'));
    assert.ok(allInvestors.detailed.card4.replace(/\s/g, '').includes('2010000₽'));
    assert.equal(allInvestors.detailed.header4, 'Прибыль инвесторов');
    assert.equal(allInvestors.detailed.header5, 'Прибыль собственника');
    assert.equal(allInvestors.detailed.taxLineVisible, true);
    assert.equal(allInvestors.detailed.scenarioYieldVisible, true);
    assert.equal(allInvestors.detailed.importedHintVisible, true);
    assert.ok(Math.abs(allInvestors.aggregated.totalShare - allInvestors.detailed.totalShare) < 1e-12);
    assert.ok(Math.abs(allInvestors.aggregated.investorsProfit - allInvestors.detailed.investorsProfit) < 1e-8);
    assert.ok(Math.abs(allInvestors.aggregated.ownerProfit - allInvestors.detailed.ownerProfit) < 1e-8);

    const autoRecovery = await page.evaluate('(' + testInvestorPoolAutoRecovery.toString() + ')()');
    assert.equal(autoRecovery.invalid.errorVisible, true);
    assert.equal(autoRecovery.invalid.resultsVisible, true);
    assert.equal(autoRecovery.invalid.staleWarningVisible, true);
    assert.equal(autoRecovery.invalid.pdfDisabled, true);
    assert.equal(autoRecovery.invalid.financialOutputsDimmed, true);
    assert.equal(autoRecovery.errorHiddenAfterFix, true);
    assert.equal(autoRecovery.staleWarningHiddenAfterFix, true);
    assert.equal(autoRecovery.pdfEnabledAfterFix, true);
    assert.equal(autoRecovery.resultsVisibleAfterFix, true);
    assert.equal(autoRecovery.totalLoanAfterFix, 10_000_000);

    const threeInvestorStart = await page.evaluate('(' + prepareThreeInvestorRegression.toString() + ')()');
    assert.equal(threeInvestorStart.invalidatedOnAdd, true);
    assert.equal(threeInvestorStart.pdfDisabledOnAdd, true);
    assert.equal(threeInvestorStart.staleWarningVisibleOnAdd, true);
    await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
    });
    await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
    });
    await delay(100);
    const invalidThirdInvestor = await page.evaluate('(' + inspectInvalidThirdInvestor.toString() + ')()');
    assert.equal(invalidThirdInvestor.rowCount, 3);
    assert.deepEqual(invalidThirdInvestor.firstAmounts, ['4000000', '6000000']);
    assert.deepEqual(invalidThirdInvestor.firstPercents, ['60', '70']);
    assert.equal(invalidThirdInvestor.thirdAmount, '1000000');
    assert.equal(invalidThirdInvestor.thirdPercent, '');
    assert.equal(invalidThirdInvestor.rowErrorVisible, true);
    assert.ok(invalidThirdInvestor.rowErrorText.includes('процент'));
    assert.equal(invalidThirdInvestor.resultsVisible, true);
    assert.equal(invalidThirdInvestor.panelVisible, true);
    assert.equal(invalidThirdInvestor.staleWarningVisible, true);
    assert.equal(invalidThirdInvestor.globalErrorHidden, true);
    assert.equal(invalidThirdInvestor.pdfDisabled, true);
    assert.equal(invalidThirdInvestor.financialOutputsDimmed, true);
    assert.equal(invalidThirdInvestor.isCalculated, false);
    assert.ok(Math.abs(invalidThirdInvestor.scrollY - threeInvestorStart.scrollY) <= 1);

    const fixedThirdInvestor = await page.evaluate('(' + fixThirdInvestor.toString() + ')()');
    assert.equal(fixedThirdInvestor.rowCount, 3);
    assert.deepEqual(fixedThirdInvestor.firstAmounts, ['4000000', '6000000']);
    assert.deepEqual(fixedThirdInvestor.firstPercents, ['60', '70']);
    assert.equal(fixedThirdInvestor.rowErrorHidden, true);
    assert.equal(fixedThirdInvestor.staleWarningHidden, true);
    assert.equal(fixedThirdInvestor.pdfEnabled, true);
    assert.equal(fixedThirdInvestor.financialOutputsCurrent, true);
    assert.equal(fixedThirdInvestor.totalLoan, 11_000_000);
    assert.equal(fixedThirdInvestor.scenarioCount, 7);
    assert.equal(fixedThirdInvestor.isCalculated, true);

    const switchState = await page.evaluate('(() => { switchInvestorScenarioView("single"); const singleHidden = document.getElementById("allInvestorsPanel").classList.contains("hidden"); switchInvestorScenarioView("all"); return { singleHidden, allVisible: !document.getElementById("allInvestorsPanel").classList.contains("hidden") }; })()');
    assert.equal(switchState.singleHidden, true);
    assert.equal(switchState.allVisible, true);

    for (const width of [375, 390, 430, 1440]) {
        await page.send('Emulation.setDeviceMetricsOverride', {
            width,
            height: width === 1440 ? 1800 : 1200,
            deviceScaleFactor: 1,
            mobile: width !== 1440
        });
        await delay(150);
        const layout = await page.evaluate('(' + inspectLayout.toString() + ')()');
        assert.ok(layout.pageWidth <= layout.viewport, 'all-investors page overflow at ' + width);
        await page.evaluate('document.getElementById("scenarioSection").scrollIntoView({ block: "start" })');
        const shot = await page.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false
        });
        fs.writeFileSync('/tmp/flipping-all-after-' + width + '.png', Buffer.from(shot.data, 'base64'));
    }

    await page.evaluate('document.getElementById("pdfVariantTitle").value = "Codex PDF All"; exportCalculationToPDF(); true');
    await delay(6000);
    const pdfFiles = fs.readdirSync(downloadPath).filter(name => name.endsWith('.pdf')).sort();
    assert.equal(pdfFiles.length, 2, 'two PDFs should be downloaded');
    const pdfStats = pdfFiles.map(name => fs.statSync(downloadPath + '/' + name));
    pdfStats.forEach(stats => assert.ok(stats.size > 10_000, 'generated PDF should not be empty'));

    const pdfCheck = await page.evaluate('(' + inspectPdf.toString() + ')()');
    assert.equal(pdfCheck.rowCount, 7);
    assert.ok(pdfCheck.html.replace(/&nbsp;|\s/g, '').includes('23000000₽'));
    assert.ok(pdfCheck.html.includes('План. расходы'));
    assert.ok(pdfCheck.html.includes('Факт. расходы'));
    assert.ok(pdfCheck.html.includes('Параметры всех инвесторов'));
    assert.ok(pdfCheck.html.includes('Совокупная доля прибыли'));
    assert.ok(pdfCheck.html.includes('9.82% годовых'));
    assert.ok(pdfCheck.firstRowText.includes('Налог'));
    assert.ok(Math.abs(pdfCheck.rootLeft) < 1, 'PDF root must start at x=0');
    assert.equal(pdfCheck.rootWidth, 700);
    assert.equal(pdfCheck.rootScrollWidth, 700);
    assert.equal(pdfCheck.windowScrollX, 0);
    assert.ok(pdfCheck.tableScrollWidth <= pdfCheck.tableClientWidth + 1);
    assert.deepEqual(page.pageErrors, [], 'browser JavaScript errors: ' + page.pageErrors.join('\n'));

    console.log('✓ browser reverse/direct round-trip');
    console.log('✓ scenario steps and base rows');
    console.log('✓ responsive widths: 375, 390, 430, 1440');
    console.log('✓ detailed and aggregated investor views');
    console.log('✓ three-investor Enter/blank-field recovery');
    console.log('✓ real PDF downloads: ' + pdfFiles.join(', '));
    console.log('✓ PDF data source, taxes and 7-row table fit');
    console.log('✓ no unhandled browser JavaScript errors');
    page.ws.close();
})().catch(error => {
    console.error(error.stack);
    process.exit(1);
});
