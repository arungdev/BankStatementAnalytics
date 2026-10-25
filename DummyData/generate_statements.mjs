import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function formatInr(val) {
  if (val === null || val === undefined || isNaN(val)) return '';
  return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── 1. GENERATE HDFC SAVINGS STATEMENT (Fixed Width) ─────────────────────────
function generateHdfcStatement() {
  const accountHolder = 'ARUN G';
  const accountNo = '50100736644871';

  let lines = [
    '',
    'HDFC BANK Ltd.                                     Page No .:   1                                        Statement of accounts',
    '',
    '                                                                         Account Branch : INDIRANAGAR',
    '                                                                         Address        : 100 FT ROAD, INDIRANAGAR,',
    `MR      ${accountHolder}                                                          BANGALORE 560038`,
    'TECH INNOVATIONS PRIVATE LIMITED                                         City           : BANGALORE',
    'BAGMANE TECH PARK, CV RAMAN NAGAR                                        State          : KARNATAKA',
    'BANGALORE 560093                                                         Phone no.      : 18002600/18001600',
    'KARNATAKA                                                                Email          : demo.user@example.com',
    '.                                                                        OD Limit       : 0  Currency : INR',
    '                                                                         Cust ID        : 984512034',
    `JOINT HOLDERS :                                                          Account No     : ${accountNo}   OTHER`,
    'Nomination : Registered                                                  Account Status : Regular  ',
    'Statement From      : 01/07/2026  To: 24/10/2026                         RTGS/NEFT IFSC : HDFC0000140    MICR : 560240004   ',
    '                                                                         Branch Code    : 0140     ',
    '                                                                         Account Type   : SAVINGS - RESIDENTS (113)',
    '--------  ----------------------------------------  ----------------  --------  ------------------  ------------------  ------------------',
    'Date      Narration				    Chq./Ref.No.      Value Dt  Withdrawal Amt.        Deposit Amt.     Closing Balance',
    '--------  ----------------------------------------  ----------------  --------  ------------------  ------------------  ------------------',
  ];

  let currentBalance = 78500.50;

  // Monthly templates for July, August, September, October 2026
  const months = [
    { name: 'JUL', num: '07', yr: '26', yrmon: '2026-07' },
    { name: 'AUG', num: '08', yr: '26', yrmon: '2026-08' },
    { name: 'SEP', num: '09', yr: '26', yrmon: '2026-09' },
    { name: 'OCT', num: '10', yr: '26', yrmon: '2026-10' },
  ];

  let refCounter = 618001000000;

  for (const m of months) {
    const txs = [
      // Salary deposit on 1st
      { day: '01', type: 'CR', amt: 145000.00, narr: `NEFT CR-NEXUS TECH-SALARY-${m.name} 2026-CMS987654` },
      // Rent payment on 2nd
      { day: '02', type: 'DR', amt: 26000.00, narr: `UPI-ARAVIND REALTY-ARAVIND@OKHDFCBANK-IOBA000-RENT-${m.name}` },
      // Groceries
      { day: '03', type: 'DR', amt: 2450.00, narr: `UPI-BLINKIT-BLINKIT@ICICI-ICIC000-GROCERIES-${m.name}` },
      // Dining / Swiggy
      { day: '04', type: 'DR', amt: 680.00, narr: `UPI-SWIGGY-SWIGGY@HDFCBANK-HDFC000-FOOD DELIVERY` },
      // Electricity bill
      { day: '06', type: 'DR', amt: 2150.00, narr: `IB BILLPAY DR-BESCOM-ELECTRICITY-${m.name}` },
      // Broadband
      { day: '07', type: 'DR', amt: 1179.00, narr: `IB BILLPAY DR-AIRTEL FIBER-9876543210` },
      // Credit card bill payment
      { day: '08', type: 'DR', amt: 24500.00, narr: `IB BILLPAY DR-653029XXXXXX1252-HDFC CC PAYMENT` },
      // Grocery Zepto
      { day: '10', type: 'DR', amt: 890.00, narr: `UPI-ZEPTO-ZEPTO@AXISBANK-UTIB000-QUICK COMMERCE` },
      // Self transfer to IOB
      { day: '12', type: 'DR', amt: 20000.00, narr: `FT- SELF TRANSFER - 065001000027720 -` },
      // Mutual Fund / Zerodha
      { day: '14', type: 'DR', amt: 25000.00, narr: `NEFT DR-ZERODHA BROKING-GROWTH SIP 500-CMS112233` },
      // Dining / Zomato
      { day: '16', type: 'DR', amt: 940.00, narr: `UPI-ZOMATO-ZOMATO@HDFCBANK-DINING OUT` },
      // Recurring Deposit
      { day: '18', type: 'DR', amt: 10000.00, narr: `12345- RD INSTALLMENT-EMERGENCY RD-HDFC` },
      // Shopping Amazon
      { day: '20', type: 'DR', amt: 3499.00, narr: `UPI-AMAZON-AMAZONPAY@APL-SHOPPING ELECTRONICS` },
      // Travel Uber
      { day: '22', type: 'DR', amt: 480.00, narr: `UPI-UBER INDIA-UBER@AXISBANK-RIDE COMMUTE` },
      // Friend Repayment
      { day: '24', type: 'CR', amt: 4500.00, narr: `UPI-PRIYA SHARMA-PRIYA@OKAXIS-SPLIT SHARE REPAYMENT` },
    ];

    if (m.num === '08') {
      // August FD investment
      txs.push({ day: '15', type: 'DR', amt: 100000.00, narr: `IB FD CREATION - 987654321 - 1 YEAR 7.1 PERCENT` });
    }
    if (m.num === '09') {
      // September Goa resort split bill
      txs.push({ day: '19', type: 'DR', amt: 18000.00, narr: `UPI-GOA RESORT-GOARESORT@HDFCBANK-VILLA BOOKING` });
      txs.push({ day: '21', type: 'CR', amt: 4500.00, narr: `UPI-RAHUL VERMA-RAHUL@OKSBI-GOA TRIP SHARE` });
      txs.push({ day: '22', type: 'CR', amt: 4500.00, narr: `UPI-AMIT PATEL-AMIT@OKICICI-GOA TRIP SHARE` });
    }

    for (const tx of txs) {
      if (tx.type === 'CR') currentBalance += tx.amt;
      else currentBalance -= tx.amt;

      refCounter += 137;
      const dateStr = `${tx.day}/${m.num}/${m.yr}`;
      const refStr = String(refCounter).padStart(16, '0');
      const wStr = tx.type === 'DR' ? formatInr(tx.amt).padStart(18, ' ') : ''.padStart(18, ' ');
      const dStr = tx.type === 'CR' ? formatInr(tx.amt).padStart(19, ' ') : ''.padStart(19, ' ');
      const bStr = formatInr(currentBalance).padStart(20, ' ');

      // Split narration into 40-char chunks for continuation lines
      const narrChunk1 = tx.narr.substring(0, 40).padEnd(40, ' ');
      const narrRest = tx.narr.substring(40);

      // Main line:
      // [0:10] Date (10)
      // [10:52] Narration chunk (42) -> 40 chars + 2 spaces
      // [52:68] Ref No (16)
      // [68:70] 2 spaces
      // [70:78] Value Dt (8)
      // [78:80] 2 spaces
      // [80:98] Withdrawal (18)
      // [98:117] Deposit (19)
      // [117:] Balance
      const line = `${dateStr}  ${narrChunk1}  ${refStr}  ${dateStr}  ${wStr}${dStr}${bStr}`;
      lines.push(line);

      if (narrRest.length > 0) {
        const narrChunk2 = narrRest.substring(0, 40);
        // Continuation line: spaces up to 10, chunk up to 52, rest blank
        const contLine = ' '.repeat(10) + narrChunk2;
        lines.push(contLine);
      }
    }
  }

  return lines.join('\r\n');
}

// ── 2. GENERATE HDFC CREDIT CARD STATEMENT (CSV ~|~ Delimited) ───────────────
function generateHdfcCreditCardStatement() {
  const lines = [
    'Name~|~ARUN G ',
    'Address~|~INDIRANAGAR 100 FT ROAD, BANGALORE ',
    'Address~|~BANGALORE-560038 KARNATAKA ',
    'Customer GSTN~|~ ',
    'Payment Due Date~|~05/11/2026 ',
    'Statement Date~|~15/10/2026 ',
    'Total Amount Due~|~24,800.00 ',
    'Minimum Amount Due~|~1,500.00 ',
    'Credit Limit~|~2,50,000.00 ',
    'Available Limit~|~2,25,200.00 ',
    'Available Cash limit~|~25,000.00 ',
    '',
    'Account Summary ',
    'Opening Bal~|~-~|~Payment / Credit~|~+~|~Purchases / Debits~|~+~|~Finance Charges~|~=~|~Total Dues ',
    '22,400.00~|~-~|~22,400.00~|~+~|~24,800.00~|~+~|~0.00~|~=~|~24,800.00 ',
    '',
    'Card No: 6530 29XX XXXX 1252 ',
    '',
    'AAN: 0001010730035761252 ',
    '',
    'Past Dues (if any) ',
    'Overlimit~|~3 Months~|~2 Months~|~1 Month~|~ Current Dues~|~Minimum Amount Due ',
    '0.00~|~0.00~|~0.00~|~0.00~|~1,500.00~|~1,500.00 ',
    '',
    'Domestic / International Transactions',
    'Transaction type~|~Primary / Addon Customer Name~|~DATE~|~Description~|~AMT~|~Debit /Credit~|~REWARDS~|~',
    // Bill payment received
    'Domestic~|~ARUN G ~|~20/09/2026 10:15:22~|~CREDIT CARD PAYMENT Net Banking (Ref# 00000000000524018457878)~|~22,400.00~|~Cr~|~~|~',
    // Electronics & Tech
    'Domestic~|~ARUN G ~|~22/09/2026 14:30:10~|~CROMA ELECTRONICS BANGALORE INDIRANAGAR~|~11,490.00~|~~|~115~|~',
    // Online shopping
    'Domestic~|~ARUN G ~|~25/09/2026 18:22:45~|~AMAZON PAY INDIA MUMBAI~|~3,899.00~|~~|~39~|~',
    // Dining
    'Domestic~|~ARUN G ~|~28/09/2026 21:10:05~|~TOIT BREWPUB INDIRANAGAR BANGALORE~|~2,850.00~|~~|~28~|~',
    // Subscriptions
    'Domestic~|~ARUN G ~|~01/10/2026 09:00:15~|~NETFLIX ENTERTAINMENT SERVICES MUMBAI~|~649.00~|~~|~6~|~',
    'Domestic~|~ARUN G ~|~02/10/2026 11:35:40~|~SPOTIFY INDIA MUMBAI~|~119.00~|~~|~1~|~',
    // Fuel
    'Domestic~|~ARUN G ~|~05/10/2026 17:45:00~|~INDIAN OIL PETROL PUMP BANGALORE~|~2,100.00~|~~|~21~|~',
    // Grocery
    'Domestic~|~ARUN G ~|~08/10/2026 19:12:30~|~NATURES BASKET INDIRANAGAR~|~1,853.00~|~~|~18~|~',
    // International Forex transaction (USD)
    'International~|~ARUN G ~|~10/10/2026 16:04:12~|~GITHUB SPONSORS USD 10.00 SAN FRANCISCO CA~|~840.00~|~~|~8~|~',
    'International~|~ARUN G ~|~12/10/2026 20:15:33~|~OPENAI API SERVICES USD 12.00 SAN FRANCISCO~|~1,000.00~|~~|~10~|~',
    '',
    'Reward Points Summary',
    'Opening Balance~|~Feature + Bonus Reward Points Earned~|~Disbursed~|~Adjusted/Lapsed~|~Closing Balance~|~Points expiring in next 30 days~|~Points expiring in next 60 days ',
    '1250~|~246~|~0~|~0~|~1496~|~0~|~0 ',
    '',
    'State account branch GSTN: 29AAACH2702H1Z1 [ State code : Karnataka ] ',
    'HSN Code : 997113 ',
    'Registered Office Address: HDFC Bank Cards Division, Door No 94 SP, Estate Bus Stand, Chennai - 600058.'
  ];

  return lines.join('\r\n');
}

// ── 3. GENERATE IOB SAVINGS STATEMENT (Fixed Width) ──────────────────────────
function generateIobStatement() {
  const accountNo = '065001000027720';
  const customerName = 'ARUN G';

  let lines = [
    '                                                                                                                                                                                                   ',
    `   Account Number                             : ${accountNo}                                                 Branch Name                      : INDIRANAGAR (0650)                            `,
    '                                                                                                                                                                                                   ',
    `   Customer Name                              : ${customerName}                                                         Branch Address                   : 100 FT ROAD, INDIRANAGAR,                      `,
    '                                                                                                                                                 BANGALORE, KARNATAKA, 560038                     ',
    '                                                                                                                                                                                                   ',
    '   Customer ID                                : 59962753                                                        Email                            : iob0650@iob.in                                  ',
    '                                                                                                                                                                                                   ',
    '   A/C Open Date                              : 15/06/2021                                                      IFSC Code                        : IOBA0000650                                     ',
    '                                                                                                                                                                                                   ',
    '   Currency                                   : INR                                                             MICR Code                        : 560020016                                       ',
    '                                                                                                                                                                                                   ',
    '   A/C Type                                   : SAVINGS ACCOUNT - PUBLIC                                                                                                                           ',
    '                                                                                                                                                                                                   ',
    '   A/C Status                                 : Active                                                                                                                                             ',
    '                                                                                                                                                                                                   ',
    '   Statement for the period from 01-07-2026 00:00:00 to 24-10-2026 23:59:59                                                                                                                        ',
    '                                                                                                                                                                                                   ',
    '                                                                                                                                                                                Balance            ',
    '            Date              Value Date           CHQ                           Remarks                             COD            Debit               Credit                                     ',
    '                                                                                                                                                                                                   ',
  ];

  let balance = 45210.00;
  const txs = [
    { date: '12/07/2026', type: 'CR', amt: 20000.00, rem: 'TRF FROM HDFC 4871 SELF' },
    { date: '15/07/2026', type: 'DR', amt: 15000.00, rem: 'NEFT/GROWW INVESTMENTS/MUTUAL FUND SIP' },
    { date: '28/07/2026', type: 'DR', amt: 1200.00, rem: 'UPI/126321072993/DR/LOCAL SUPERMART/IOB/GROCERY' },
    { date: '12/08/2026', type: 'CR', amt: 20000.00, rem: 'TRF FROM HDFC 4871 SELF' },
    { date: '15/08/2026', type: 'DR', amt: 15000.00, rem: 'NEFT/GROWW INVESTMENTS/MUTUAL FUND SIP' },
    { date: '25/08/2026', type: 'DR', amt: 3500.00, rem: 'UPI/210814641932/DR/CITY CLINIC MEDICAL/IOB/HEALTH' },
    { date: '12/09/2026', type: 'CR', amt: 20000.00, rem: 'TRF FROM HDFC 4871 SELF' },
    { date: '15/09/2026', type: 'DR', amt: 15000.00, rem: 'NEFT/GROWW INVESTMENTS/MUTUAL FUND SIP' },
    { date: '30/09/2026', type: 'CR', amt: 1145.00, rem: 'Int.Pd: 01-07-2026 to 30-09-2026' },
    { date: '12/10/2026', type: 'CR', amt: 20000.00, rem: 'TRF FROM HDFC 4871 SELF' },
    { date: '15/10/2026', type: 'DR', amt: 15000.00, rem: 'NEFT/GROWW INVESTMENTS/MUTUAL FUND SIP' },
    { date: '20/10/2026', type: 'DR', amt: 2500.00, rem: '-ATM-CASH WITHDRAWAL INDIRANAGAR ATM' },
  ];

  for (const t of txs) {
    if (t.type === 'CR') balance += t.amt;
    else balance -= t.amt;

    // Line 1: Remarks indented
    lines.push('                                                            ' + t.rem);

    // Line 2: Date, Value Date, TRF, Debit/Credit, Balance
    const dStr = t.type === 'DR' ? formatInr(t.amt).padStart(14, ' ') : ''.padStart(14, ' ');
    const cStr = t.type === 'CR' ? formatInr(t.amt).padStart(14, ' ') : ''.padStart(14, ' ');
    const bStr = formatInr(balance).padStart(16, ' ');

    // Match column thresholds:
    // Debit < 150, Credit >= 150, Balance last
    // Date at col 8, Value Date at col 29, COD at col 85
    let line = '        ' + t.date.padEnd(21, ' ') + t.date.padEnd(56, ' ') + 'TRF';
    line = line.padEnd(114, ' ') + dStr;
    line = line.padEnd(150, ' ') + cStr;
    line = line.padEnd(178, ' ') + bStr;
    lines.push(line);
    lines.push('                                                                                                                                                                                                   ');
  }

  return lines.join('\r\n');
}

// ── 4. WRITE THE FILES ───────────────────────────────────────────────────────
const dummyDir = path.resolve(__dirname);
fs.writeFileSync(path.join(dummyDir, 'hdfc_savings_statement.txt'), generateHdfcStatement(), 'utf8');
fs.writeFileSync(path.join(dummyDir, 'hdfc_creditcard_statement.csv'), generateHdfcCreditCardStatement(), 'utf8');
fs.writeFileSync(path.join(dummyDir, 'iob_savings_statement.txt'), generateIobStatement(), 'utf8');

console.log('Generated statement files in ' + dummyDir);
