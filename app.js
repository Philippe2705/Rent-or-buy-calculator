(function () {
    'use strict';

    // ── Formatters ──────────────────────────────────────────────────────
    const fmtCHF = new Intl.NumberFormat('de-CH', {
        style: 'currency',
        currency: 'CHF',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

    const fmtNum = new Intl.NumberFormat('de-CH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

    const fmtPct = (v) => (v * 100).toFixed(1) + '%';

    // ── Default values ──────────────────────────────────────────────────
    const DEFAULTS = {
        propertyPrice: 1200000,
        downPaymentPct: 30,
        notaryCostsPct: 3,
        propertyAppreciation: 1,
        mortgageRate: 1.5,
        amortizationYears: 15,
        maintenancePct: 1,
        insurancePct: 0.05,
        eigenmietwertPct: 3.5,
        marginalTaxRate: 25,
        wealthTaxRate: 3,
        monthlyRent: 2500,
        rentIncrease: 1.5,
        investmentReturn: 5,
        dividendYieldPct: 2,
        simulationYears: 30,
        sellingCostsPct: 3,
    };

    // ── Collect all input IDs ───────────────────────────────────────────
    const INPUT_IDS = Object.keys(DEFAULTS);

    // ── Read parameters from the DOM ────────────────────────────────────
    function getParams() {
        const p = {};
        for (const id of INPUT_IDS) {
            p[id] = +document.getElementById(id).value;
        }
        return p;
    }

    // ── Core simulation engine ──────────────────────────────────────────
    function simulate(p) {
        const downPayment = p.propertyPrice * (p.downPaymentPct / 100);
        const notaryCosts = p.propertyPrice * (p.notaryCostsPct / 100);
        const totalUpfront = downPayment + notaryCosts;
        const totalMortgage = p.propertyPrice - downPayment;
        const firstMortgageLimit = p.propertyPrice * 0.65;
        const secondMortgage = Math.max(0, totalMortgage - firstMortgageLimit);
        const annualAmort = secondMortgage > 0
            ? secondMortgage / p.amortizationYears
            : 0;

        // After-tax investment return:
        // Capital gains are tax-free in CH; only dividends are taxed
        const afterTaxReturn =
            (p.investmentReturn / 100) -
            (p.dividendYieldPct / 100) * (p.marginalTaxRate / 100);
        const monthlyReturn = Math.pow(1 + afterTaxReturn, 1 / 12) - 1;

        // State variables
        let mortgageBalance = totalMortgage;
        let renterPortfolio = totalUpfront;
        let propertyValue = p.propertyPrice;
        let cumBuyerNonEquity = 0;
        let cumRenterCost = 0;

        const results = [];

        // Year 0: starting snapshot (purchase day)
        results.push(makeRow(0, {
            propertyValue,
            mortgageBalance,
            renterPortfolio,
            buyerMonthlyCost: 0,
            renterMonthlyCost: p.monthlyRent,
            buyerAnnualNonEquity: 0,
            renterAnnualCost: 0,
            cumBuyerNonEquity: 0,
            cumRenterCost: 0,
            interest: 0,
            amort: 0,
            maintenance: 0,
            insurance: 0,
            netTax: 0,
            rent: p.monthlyRent,
            sellingCostsPct: p.sellingCostsPct,
        }));

        for (let year = 1; year <= p.simulationYears; year++) {
            // Annual costs based on start-of-year values
            const interest = mortgageBalance * (p.mortgageRate / 100);
            const amort =
                year <= p.amortizationYears && secondMortgage > 0
                    ? annualAmort
                    : 0;
            const maint = propertyValue * (p.maintenancePct / 100);
            const insur = propertyValue * (p.insurancePct / 100);
            const eigenmietwert = propertyValue * (p.eigenmietwertPct / 100);

            // Net tax: positive → buyer pays more tax, negative → tax benefit
            const netTax =
                (eigenmietwert - interest - maint) * (p.marginalTaxRate / 100);

            // Wealth taxes
            const buyerWealth =
                Math.max(0, propertyValue - mortgageBalance) *
                (p.wealthTaxRate / 1000);
            const renterWealth =
                Math.max(0, renterPortfolio) * (p.wealthTaxRate / 1000);

            // Buyer total cash outflow (amortization included — it's cash spent)
            const buyerCashflow =
                interest + amort + maint + insur + netTax + buyerWealth;
            const buyerNonEquity =
                interest + maint + insur + netTax + buyerWealth;

            // Renter costs
            const currentRent =
                p.monthlyRent * Math.pow(1 + p.rentIncrease / 100, year - 1);
            const renterAnnualCost = currentRent * 12 + renterWealth;

            cumBuyerNonEquity += buyerNonEquity;
            cumRenterCost += renterAnnualCost;

            // Monthly differential: positive → renter saves more (buying is expensive)
            const monthlyDiff = (buyerCashflow - renterAnnualCost) / 12;

            // Grow renter portfolio month by month
            for (let m = 0; m < 12; m++) {
                renterPortfolio =
                    renterPortfolio * (1 + monthlyReturn) + monthlyDiff;
            }

            // End-of-year updates
            propertyValue =
                p.propertyPrice *
                Math.pow(1 + p.propertyAppreciation / 100, year);
            mortgageBalance = Math.max(0, mortgageBalance - amort);

            results.push(makeRow(year, {
                propertyValue,
                mortgageBalance,
                renterPortfolio,
                buyerMonthlyCost: buyerCashflow / 12,
                renterMonthlyCost: currentRent + renterWealth / 12,
                buyerAnnualNonEquity: buyerNonEquity,
                renterAnnualCost,
                cumBuyerNonEquity,
                cumRenterCost,
                interest,
                amort,
                maintenance: maint,
                insurance: insur,
                netTax,
                rent: currentRent,
                sellingCostsPct: p.sellingCostsPct,
            }));
        }

        return {
            results,
            meta: {
                totalUpfront,
                downPayment,
                notaryCosts,
                totalMortgage,
                firstMortgage: Math.min(totalMortgage, firstMortgageLimit),
                secondMortgage,
                annualAmort,
                afterTaxReturn,
            },
        };
    }

    function makeRow(year, d) {
        const equity = d.propertyValue - d.mortgageBalance;
        const equityAfterSell =
            d.propertyValue * (1 - d.sellingCostsPct / 100) -
            d.mortgageBalance;
        return {
            year,
            propertyValue: d.propertyValue,
            mortgageBalance: d.mortgageBalance,
            buyerEquity: equity,
            buyerEquityAfterSell: equityAfterSell,
            renterPortfolio: d.renterPortfolio,
            advantage: equity - d.renterPortfolio,
            advantageAfterSell: equityAfterSell - d.renterPortfolio,
            buyerMonthlyCost: d.buyerMonthlyCost,
            renterMonthlyCost: d.renterMonthlyCost,
            buyerAnnualNonEquity: d.buyerAnnualNonEquity,
            renterAnnualCost: d.renterAnnualCost,
            cumBuyerNonEquity: d.cumBuyerNonEquity,
            cumRenterCost: d.cumRenterCost,
            interest: d.interest,
            amort: d.amort,
            maintenance: d.maintenance,
            insurance: d.insurance,
            netTax: d.netTax,
            rent: d.rent,
        };
    }

    // ── Affordability check (Swiss bank rule) ───────────────────────────
    function affordability(p, meta) {
        // Banks use 5% imputed interest + amortization + 1% maintenance
        // Must be ≤ 33% of gross income
        const imputedInterest = meta.totalMortgage * 0.05;
        const imputedMaint = p.propertyPrice * 0.01;
        const totalImputed = imputedInterest + meta.annualAmort + imputedMaint;
        const minGrossIncome = totalImputed / 0.33;
        return {
            imputedInterest,
            imputedMaint,
            amort: meta.annualAmort,
            totalImputed,
            minGrossIncome,
            monthlyPayment:
                meta.totalMortgage * (p.mortgageRate / 100) / 12 +
                meta.annualAmort / 12,
        };
    }

    // ── Render: Summary Cards ───────────────────────────────────────────
    function renderSummary(data, p) {
        const { results, meta } = data;
        const last = results[results.length - 1];
        const aff = affordability(p, meta);

        // Find break-even year (when buyer equity >= renter portfolio)
        let breakEvenYear = null;
        for (let i = 1; i < results.length; i++) {
            if (
                results[i].buyerEquity >= results[i].renterPortfolio &&
                results[i - 1].buyerEquity < results[i - 1].renterPortfolio
            ) {
                breakEvenYear = results[i].year;
                break;
            }
        }

        const buyerWins = last.buyerEquity >= last.renterPortfolio;
        const diff = Math.abs(last.advantage);

        const cards = [
            {
                label: 'Upfront Cash Needed',
                value: fmtCHF.format(meta.totalUpfront),
                detail: `Down payment ${fmtCHF.format(meta.downPayment)} + fees ${fmtCHF.format(meta.notaryCosts)}`,
                cls: '',
            },
            {
                label: `Buyer Net Worth (Year ${p.simulationYears})`,
                value: fmtCHF.format(last.buyerEquity),
                detail: `Property ${fmtCHF.format(last.propertyValue)} − mortgage ${fmtCHF.format(last.mortgageBalance)}`,
                cls: 'buying',
            },
            {
                label: `Renter Net Worth (Year ${p.simulationYears})`,
                value: fmtCHF.format(last.renterPortfolio),
                detail: `Portfolio after ${p.simulationYears} years of investing`,
                cls: 'renting',
            },
            {
                label: 'Break-Even Year',
                value: breakEvenYear !== null ? `Year ${breakEvenYear}` : `Never (within ${p.simulationYears}y)`,
                detail: breakEvenYear !== null
                    ? 'When buying overtakes renting'
                    : 'Renting stays ahead in this simulation',
                cls: 'breakeven',
            },
            {
                label: `Winner at Year ${p.simulationYears}`,
                value: buyerWins ? '🏠 Buying' : '🏢 Renting',
                detail: `Ahead by ${fmtCHF.format(diff)}`,
                cls: 'winner',
            },
        ];

        const el = document.getElementById('summaryCards');
        el.innerHTML = cards
            .map(
                (c) => `
            <div class="summary-card ${c.cls}">
                <div class="label">${c.label}</div>
                <div class="value">${c.value}</div>
                <div class="detail">${c.detail}</div>
            </div>`
            )
            .join('');

        // Affordability box
        const affEl = document.getElementById('affordabilityBox');
        affEl.innerHTML = `
            <h4>🏦 Swiss Bank Affordability Check</h4>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Imputed interest (5%)</span>
                    <span class="info-value">${fmtCHF.format(aff.imputedInterest)}/yr</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Amortization</span>
                    <span class="info-value">${fmtCHF.format(aff.amort)}/yr</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Maintenance (1%)</span>
                    <span class="info-value">${fmtCHF.format(aff.imputedMaint)}/yr</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Total imputed costs</span>
                    <span class="info-value">${fmtCHF.format(aff.totalImputed)}/yr</span>
                </div>
                <div class="info-item">
                    <span class="info-label"><strong>Min. gross income (33% rule)</strong></span>
                    <span class="info-value"><strong>${fmtCHF.format(aff.minGrossIncome)}/yr</strong></span>
                </div>
                <div class="info-item">
                    <span class="info-label">Actual monthly mortgage payment</span>
                    <span class="info-value">${fmtCHF.format(aff.monthlyPayment)}/mo</span>
                </div>
            </div>`;
    }

    // ── Render: Warnings ────────────────────────────────────────────────
    function renderWarnings(p, meta) {
        const el = document.getElementById('warnings');
        const warns = [];

        if (p.downPaymentPct < 20) {
            warns.push(
                'Swiss banks typically require a minimum 20% down payment, ' +
                'with at least 10% from non-pension assets (not Pillar 2).'
            );
        }
        if (meta.totalMortgage > p.propertyPrice * 0.8) {
            warns.push(
                'Loan-to-value exceeds 80%. Most Swiss banks will not finance this.'
            );
        }
        if (p.dividendYieldPct > p.investmentReturn) {
            warns.push(
                'Dividend yield exceeds total return — this implies negative capital gains.'
            );
        }

        el.innerHTML = warns
            .map(
                (w) =>
                    `<div class="warning-item"><span class="warn-icon">⚠️</span>${w}</div>`
            )
            .join('');
    }

    // ── Render: Charts ──────────────────────────────────────────────────
    let chartNetWorth, chartCost, chartAdvantage;

    const CHART_COLORS = {
        buyer: '#DC0018',
        buyerLight: 'rgba(220, 0, 24, 0.1)',
        buyerSell: '#e17055',
        renter: '#0984e3',
        renterLight: 'rgba(9, 132, 227, 0.1)',
        green: '#00b894',
        greenLight: 'rgba(0, 184, 148, 0.25)',
        red: '#d63031',
        redLight: 'rgba(214, 48, 49, 0.25)',
    };

    function buildCharts(data) {
        const { results } = data;
        const labels = results.map((r) => r.year);

        // ── Chart 1: Net Worth ──
        const ctx1 = document.getElementById('netWorthChart').getContext('2d');
        const netWorthData = {
            labels,
            datasets: [
                {
                    label: 'Buyer Equity',
                    data: results.map((r) => r.buyerEquity),
                    borderColor: CHART_COLORS.buyer,
                    backgroundColor: CHART_COLORS.buyerLight,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2.5,
                },
                {
                    label: 'Buyer Equity (after selling costs)',
                    data: results.map((r) => r.buyerEquityAfterSell),
                    borderColor: CHART_COLORS.buyerSell,
                    borderDash: [6, 4],
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                },
                {
                    label: 'Renter Portfolio',
                    data: results.map((r) => r.renterPortfolio),
                    borderColor: CHART_COLORS.renter,
                    backgroundColor: CHART_COLORS.renterLight,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2.5,
                },
            ],
        };

        if (chartNetWorth) chartNetWorth.destroy();
        chartNetWorth = new Chart(ctx1, {
            type: 'line',
            data: netWorthData,
            options: chartOptions('CHF'),
        });

        // ── Chart 2: Monthly Costs ──
        const ctx2 = document.getElementById('costChart').getContext('2d');
        // Skip year 0 for cost chart
        const costResults = results.slice(1);
        const costLabels = costResults.map((r) => r.year);

        const costData = {
            labels: costLabels,
            datasets: [
                {
                    label: 'Buyer Monthly Cost',
                    data: costResults.map((r) => r.buyerMonthlyCost),
                    borderColor: CHART_COLORS.buyer,
                    backgroundColor: CHART_COLORS.buyerLight,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2.5,
                },
                {
                    label: 'Monthly Rent',
                    data: costResults.map((r) => r.renterMonthlyCost),
                    borderColor: CHART_COLORS.renter,
                    backgroundColor: CHART_COLORS.renterLight,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2.5,
                },
            ],
        };

        if (chartCost) chartCost.destroy();
        chartCost = new Chart(ctx2, {
            type: 'line',
            data: costData,
            options: chartOptions('CHF/mo'),
        });

        // ── Chart 3: Buying Advantage ──
        const ctx3 = document.getElementById('advantageChart').getContext('2d');
        const advData = results.map((r) => r.advantage);

        // Split into positive / negative for coloring
        const advDataset = {
            labels,
            datasets: [
                {
                    label: 'Buying Advantage',
                    data: advData,
                    borderColor: advData.map((v) =>
                        v >= 0 ? CHART_COLORS.green : CHART_COLORS.red
                    ),
                    backgroundColor: advData.map((v) =>
                        v >= 0 ? CHART_COLORS.greenLight : CHART_COLORS.redLight
                    ),
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2,
                    segment: {
                        borderColor: (ctx) =>
                            ctx.p1.parsed.y >= 0
                                ? CHART_COLORS.green
                                : CHART_COLORS.red,
                        backgroundColor: (ctx) =>
                            ctx.p1.parsed.y >= 0
                                ? CHART_COLORS.greenLight
                                : CHART_COLORS.redLight,
                    },
                },
            ],
        };

        if (chartAdvantage) chartAdvantage.destroy();
        chartAdvantage = new Chart(ctx3, {
            type: 'line',
            data: advDataset,
            options: {
                ...chartOptions('CHF'),
                plugins: {
                    ...chartOptions('CHF').plugins,
                    annotation: undefined,
                },
            },
        });
    }

    function chartOptions(unit) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 16,
                        font: { size: 11 },
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            `${ctx.dataset.label}: ${fmtCHF.format(ctx.parsed.y)}`,
                        title: (items) => `Year ${items[0].label}`,
                    },
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Year',
                        font: { size: 11, weight: '600' },
                        color: '#636e72',
                    },
                    grid: { display: false },
                    ticks: { font: { size: 10 } },
                },
                y: {
                    title: {
                        display: true,
                        text: unit,
                        font: { size: 11, weight: '600' },
                        color: '#636e72',
                    },
                    ticks: {
                        font: { size: 10 },
                        callback: (v) => fmtNum.format(v),
                    },
                    grid: { color: 'rgba(0,0,0,0.04)' },
                },
            },
        };
    }

    // ── Render: Table ───────────────────────────────────────────────────
    function renderTable(data) {
        const { results } = data;
        const tbody = document.getElementById('detailTableBody');

        // Find break-even year
        let breakEvenYear = null;
        for (let i = 1; i < results.length; i++) {
            if (
                results[i].advantage >= 0 &&
                results[i - 1].advantage < 0
            ) {
                breakEvenYear = results[i].year;
                break;
            }
        }

        tbody.innerHTML = results
            .map((r) => {
                const advClass =
                    r.advantage >= 0 ? 'advantage-positive' : 'advantage-negative';
                const rowClass =
                    r.year === breakEvenYear ? 'breakeven-row' : '';
                const arrow = r.advantage >= 0 ? '▲' : '▼';
                return `<tr class="${rowClass}">
                    <td>${r.year}</td>
                    <td>${fmtCHF.format(r.propertyValue)}</td>
                    <td>${fmtCHF.format(r.mortgageBalance)}</td>
                    <td>${fmtCHF.format(r.buyerEquity)}</td>
                    <td>${fmtCHF.format(r.renterPortfolio)}</td>
                    <td>${r.year === 0 ? '—' : fmtCHF.format(r.buyerMonthlyCost)}</td>
                    <td>${fmtCHF.format(r.renterMonthlyCost)}</td>
                    <td class="${advClass}">${r.year === 0 ? '—' : arrow + ' ' + fmtCHF.format(Math.abs(r.advantage))}</td>
                </tr>`;
            })
            .join('');
    }

    // ── Computed hints ──────────────────────────────────────────────────
    function updateHints(p, meta) {
        document.getElementById('downPaymentAmount').textContent =
            '= ' + fmtCHF.format(meta.downPayment);
        document.getElementById('notaryCostsAmount').textContent =
            '= ' + fmtCHF.format(meta.notaryCosts);

        const mortInfo = document.getElementById('mortgageInfo');
        if (meta.secondMortgage > 0) {
            mortInfo.innerHTML =
                `1st mortgage: ${fmtCHF.format(meta.firstMortgage)} (65% LTV)<br>` +
                `2nd mortgage: ${fmtCHF.format(meta.secondMortgage)} (amortized over ${p.amortizationYears}y)<br>` +
                `Annual amortization: ${fmtCHF.format(meta.annualAmort)}`;
        } else {
            mortInfo.innerHTML =
                `Total mortgage: ${fmtCHF.format(meta.totalMortgage)} (≤ 65% LTV, no mandatory amortization)`;
        }

        document.getElementById('afterTaxReturnInfo').textContent =
            `After-tax return: ${(meta.afterTaxReturn * 100).toFixed(2)}%/yr`;
    }

    // ── Main update function ────────────────────────────────────────────
    function update() {
        const p = getParams();
        const data = simulate(p);

        renderWarnings(p, data.meta);
        updateHints(p, data.meta);
        renderSummary(data, p);
        buildCharts(data);
        renderTable(data);
    }

    // ── Event wiring ────────────────────────────────────────────────────
    let debounceTimer;

    function init() {
        // Attach change listeners to all inputs
        for (const id of INPUT_IDS) {
            const el = document.getElementById(id);
            el.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(update, 150);
            });
        }

        // Range slider label
        const rangeEl = document.getElementById('simulationYears');
        const rangeLbl = document.getElementById('simulationYearsValue');
        rangeEl.addEventListener('input', () => {
            rangeLbl.textContent = rangeEl.value + ' years';
        });

        // Reset button
        document.getElementById('resetBtn').addEventListener('click', () => {
            for (const id of INPUT_IDS) {
                document.getElementById(id).value = DEFAULTS[id];
            }
            rangeLbl.textContent = DEFAULTS.simulationYears + ' years';
            update();
        });

        // Initial render
        update();
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
