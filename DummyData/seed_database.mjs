import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BSA_URL || 'http://127.0.0.1:5085';

async function run() {
  console.log(`Connecting to BankStatementAnalytics at ${BASE}...`);

  let cookie = '';
  // 1. Authenticate / Login
  let loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'arun', password: 'Password123!' })
  });

  if (!loginRes.ok) {
    console.log('Login failed, attempting initial setup...');
    const setupRes = await fetch(`${BASE}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'arun', password: 'Password123!' })
    });
    if (!setupRes.ok) {
      console.error('Setup failed:', await setupRes.text());
    } else {
      console.log('Admin account created successfully.');
    }

    loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'arun', password: 'Password123!' })
    });
  }

  const setCookie = loginRes.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
  console.log('Authenticated as user: arun');

  const headers = {
    'Cookie': cookie,
    'Content-Type': 'application/json'
  };

  // 2. Fetch existing accounts or create them
  const accRes = await fetch(`${BASE}/api/accounts`, { headers: { 'Cookie': cookie } });
  const accounts = await accRes.json();
  console.log(`Found ${accounts.length} existing accounts.`);

  let hdfcAcc = accounts.find(a => a.bankName === 'HDFC' || a.bankName === 0);
  let iobAcc = accounts.find(a => a.bankName === 'IOB' || a.bankName === 2);
  let ccAcc = accounts.find(a => a.bankName === 'HDFCCreditCard' || a.bankName === 1);

  if (!hdfcAcc) {
    console.log('Creating HDFC Savings account...');
    const res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountNumber: '50100736644871',
        accountHolderName: 'Arun G',
        bankName: 'HDFC',
        branchCode: '0140'
      })
    });
    hdfcAcc = await res.json();
    console.log('Created HDFC account ID:', hdfcAcc.id);
  } else {
    console.log('Using existing HDFC account ID:', hdfcAcc.id);
  }

  if (!iobAcc) {
    console.log('Creating IOB Savings account...');
    const res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountNumber: '065001000027720',
        accountHolderName: 'Arun G',
        bankName: 'IOB',
        branchCode: '0650'
      })
    });
    iobAcc = await res.json();
    console.log('Created IOB account ID:', iobAcc.id);
  } else {
    console.log('Using existing IOB account ID:', iobAcc.id);
  }

  if (!ccAcc) {
    console.log('Creating HDFC Credit Card account...');
    const res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountNumber: '653029XXXXXX1252',
        accountHolderName: 'Arun G',
        bankName: 'HDFCCreditCard',
        creditLimit: 250000,
        statementDay: 15
      })
    });
    ccAcc = await res.json();
    console.log('Created Credit Card account ID:', ccAcc.id);
  } else {
    console.log('Using existing Credit Card account ID:', ccAcc.id);
  }

  // 3. Upload statement files
  async function uploadFile(accId, fileName, relPath) {
    const filePath = path.join(__dirname, relPath);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return;
    }
    const buf = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('accountId', String(accId));
    form.append('file', new Blob([buf]), fileName);

    console.log(`Uploading ${fileName} to account ${accId}...`);
    const res = await fetch(`${BASE}/api/statements/upload`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: form
    });
    const status = res.status;
    const text = await res.text();
    console.log(`Upload result for ${fileName}: status ${status}`);
  }

  await uploadFile(hdfcAcc.id, 'hdfc_savings_statement.txt', 'hdfc_savings_statement.txt');
  await uploadFile(iobAcc.id, 'iob_savings_statement.txt', 'iob_savings_statement.txt');
  await uploadFile(ccAcc.id, 'hdfc_creditcard_statement.csv', 'hdfc_creditcard_statement.csv');

  // 4. Create Budgets
  const budgetList = [
    { category: 'Groceries', monthlyLimit: 12000 },
    { category: 'Dining Out', monthlyLimit: 8000 },
    { category: 'Food Delivery', monthlyLimit: 5000 },
    { category: 'Shopping', monthlyLimit: 15000 },
    { category: 'Bills & Utilities', monthlyLimit: 6000 },
    { category: 'Transportation', monthlyLimit: 4000 },
    { category: 'Entertainment', monthlyLimit: 2500 }
  ];

  for (const b of budgetList) {
    try {
      const res = await fetch(`${BASE}/api/budgets`, {
        method: 'POST',
        headers,
        body: JSON.stringify(b)
      });
      console.log(`Budget for ${b.category}: ${res.status}`);
    } catch (e) {
      console.error(`Failed budget ${b.category}:`, e.message);
    }
  }

  // 5. Create Recurring Bills
  const billsList = [
    { name: 'BESCOM Electricity', matchKey: 'BESCOM', expectedAmount: 2150, dueDayOfMonth: 6, cadence: 'Monthly' },
    { name: 'Airtel Fiber Broadband', matchKey: 'AIRTEL', expectedAmount: 1179, dueDayOfMonth: 7, cadence: 'Monthly' },
    { name: 'HDFC Millennia Credit Card', matchKey: 'HDFC CC', expectedAmount: 24800, dueDayOfMonth: 5, cadence: 'Monthly' },
    { name: 'Netflix Subscription', matchKey: 'NETFLIX', expectedAmount: 649, dueDayOfMonth: 1, cadence: 'Monthly' },
    { name: 'Spotify Music', matchKey: 'SPOTIFY', expectedAmount: 119, dueDayOfMonth: 2, cadence: 'Monthly' },
  ];

  for (const bill of billsList) {
    try {
      const res = await fetch(`${BASE}/api/bills`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bill)
      });
      console.log(`Bill ${bill.name}: ${res.status}`);
    } catch (e) {
      console.error(`Failed bill ${bill.name}:`, e.message);
    }
  }

  // 6. Create Savings Goals
  const goalsList = [
    { name: 'Emergency Reserve (6 Months)', targetAmount: 300000, currentSaved: 210000, category: 'Investments', notes: 'Liquid reserve in high-yield savings & FD' },
    { name: 'Apple MacBook Pro M4 Max', targetAmount: 220000, currentSaved: 165000, category: 'Electronics', notes: 'Upgrading primary development workstation' },
    { name: 'Goa Holiday Villa & Tour', targetAmount: 60000, currentSaved: 55000, category: 'Travel', notes: 'Year-end vacation budget' }
  ];

  for (const g of goalsList) {
    try {
      const res = await fetch(`${BASE}/api/savings-goals`, {
        method: 'POST',
        headers,
        body: JSON.stringify(g)
      });
      console.log(`Goal ${g.name}: ${res.status}`);
    } catch (e) {
      console.error(`Failed goal ${g.name}:`, e.message);
    }
  }

  // 7. Create Investments (Deposits)
  const depositsList = [
    { kind: 'Fixed', matchKey: 'IB FD CREATION - 987654321', nickname: '1-Year High Yield Term Deposit', interestRate: 7.1, termMonths: 12, maturityDate: '2027-08-15', note: 'Cumulative interest compounded quarterly' },
    { kind: 'Recurring', matchKey: '12345- RD INSTALLMENT', nickname: 'Emergency Recurring Deposit', interestRate: 6.8, termMonths: 24, maturityDate: '2028-07-18', note: 'Monthly installment auto-debited' }
  ];

  for (const dep of depositsList) {
    try {
      const res = await fetch(`${BASE}/api/deposits`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(dep)
      });
      console.log(`Deposit ${dep.nickname}: ${res.status}`);
    } catch (e) {
      console.error(`Failed deposit ${dep.nickname}:`, e.message);
    }
  }

  // 8. Create Bill Splits (Shared Groups)
  const splitsList = [
    {
      groupName: 'Goa Trip 2026',
      title: 'Beachside Villa & Scooters Rental',
      description: '4-day luxury villa in Candolim + 2 Activas',
      date: '2026-09-19T14:00:00',
      totalAmount: 18000,
      userShareAmount: 4500,
      members: [
        { participantName: 'Arun G', assignedAmount: 4500, paidAmount: 4500, isSettled: true, isUser: true },
        { participantName: 'Rahul Verma', participantVpa: 'rahul@oksbi', assignedAmount: 4500, paidAmount: 4500, isSettled: true, isUser: false, notes: 'Paid via GPay on Sep 21' },
        { participantName: 'Amit Patel', participantVpa: 'amit@okicici', assignedAmount: 4500, paidAmount: 4500, isSettled: true, isUser: false, notes: 'Paid via UPI on Sep 22' },
        { participantName: 'Priya Sharma', participantVpa: 'priya@okaxis', assignedAmount: 4500, paidAmount: 4500, isSettled: true, isUser: false, notes: 'Paid via PhonePe' }
      ]
    },
    {
      groupName: 'Indiranagar Flat 402',
      title: 'Airtel Broadband & BESCOM Power Bill',
      description: 'October combined household utilities',
      date: '2026-10-06T18:00:00',
      totalAmount: 3329,
      userShareAmount: 1110,
      members: [
        { participantName: 'Arun G', assignedAmount: 1110, paidAmount: 1110, isSettled: true, isUser: true },
        { participantName: 'Karthik Nair', participantVpa: 'karthik@okhdfc', assignedAmount: 1110, paidAmount: 1110, isSettled: true, isUser: false, notes: 'Received' },
        { participantName: 'Deepak Raj', participantVpa: 'deepak@okaxis', assignedAmount: 1109, paidAmount: 0, isSettled: false, isUser: false, notes: 'Pending reminder sent' }
      ]
    },
    {
      groupName: 'Weekend Dinners',
      title: 'Toit Craft Brewery Dinner & Drinks',
      description: 'Dinner outing with colleagues',
      date: '2026-09-28T22:30:00',
      totalAmount: 4850,
      userShareAmount: 1620,
      members: [
        { participantName: 'Arun G', assignedAmount: 1620, paidAmount: 1620, isSettled: true, isUser: true },
        { participantName: 'Sneha Reddy', participantVpa: 'sneha@okicici', assignedAmount: 1615, paidAmount: 1615, isSettled: true, isUser: false },
        { participantName: 'Vikram Joshi', participantVpa: 'vikram@okpaytm', assignedAmount: 1615, paidAmount: 0, isSettled: false, isUser: false, notes: 'Will settle over weekend' }
      ]
    }
  ];

  for (const s of splitsList) {
    try {
      const res = await fetch(`${BASE}/api/split-groups`, {
        method: 'POST',
        headers,
        body: JSON.stringify(s)
      });
      console.log(`Split Group ${s.title}: ${res.status}`);
    } catch (e) {
      console.error(`Failed split ${s.title}:`, e.message);
    }
  }

  console.log('Seeding completed successfully!');
}

run().catch(console.error);
