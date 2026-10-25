import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gpayDir = path.join(__dirname, 'gpay_temp');
const actDir = path.join(gpayDir, 'Takeout', 'Google Pay', 'My Activity');
const expDir = path.join(gpayDir, 'Takeout', 'Google Pay', 'Group expenses');
const rewDir = path.join(gpayDir, 'Takeout', 'Google Pay', 'Rewards earned');

fs.mkdirSync(actDir, { recursive: true });
fs.mkdirSync(expDir, { recursive: true });
fs.mkdirSync(rewDir, { recursive: true });

const html = `
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Paid ₹2,450.00 to Blinkit using Bank Account ...4871<br>3 Aug 2026, 18:45:00 +05:30<br><b>Details:</b><br>UPI ref 618001000274<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Paid ₹680.00 to Swiggy using Bank Account ...4871<br>4 Aug 2026, 20:15:00 +05:30<br><b>Details:</b><br>UPI ref 618001000411<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Paid ₹890.00 to Zepto using Bank Account ...4871<br>10 Aug 2026, 11:20:00 +05:30<br><b>Details:</b><br>UPI ref 618001000959<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Paid ₹3,499.00 to Amazon Pay using Bank Account ...4871<br>20 Aug 2026, 15:30:00 +05:30<br><b>Details:</b><br>UPI ref 618001001644<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Received ₹4,500.00 from Priya Sharma using Bank Account ...4871<br>24 Aug 2026, 14:10:00 +05:30<br><b>Details:</b><br>UPI ref 618001001918<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Paid ₹18,000.00 to Goa Resort using Bank Account ...4871<br>19 Sep 2026, 12:00:00 +05:30<br><b>Details:</b><br>UPI ref 618001003973<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Received ₹4,500.00 from Rahul Verma using Bank Account ...4871<br>21 Sep 2026, 16:30:00 +05:30<br><b>Details:</b><br>UPI ref 618001004110<br>Completed<br></div></div>
<div class="outer-cell"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Received ₹4,500.00 from Amit Patel using Bank Account ...4871<br>22 Sep 2026, 11:45:00 +05:30<br><b>Details:</b><br>UPI ref 618001004247<br>Completed<br></div></div>
`;

fs.writeFileSync(path.join(actDir, 'My Activity.html'), html, 'utf8');

const cashback = 'Date,Reward Amount,Description\n2026-08-05,15.00,Cashback for Electricity bill\n2026-09-20,25.00,Cashback for Merchant payment\n';
fs.writeFileSync(path.join(rewDir, 'Cashback rewards.csv'), cashback, 'utf8');

const groups = [
  {
    GroupName: 'Goa Trip 2026',
    Title: 'Beachside Villa & Scooters Rental',
    TotalAmount: 18000,
    UserShareAmount: 4500,
    Date: '2026-09-19',
    Members: [
      { ParticipantName: 'Arun G', AssignedAmount: 4500, PaidAmount: 4500, IsSettled: true },
      { ParticipantName: 'Rahul Verma', AssignedAmount: 4500, PaidAmount: 4500, IsSettled: true },
      { ParticipantName: 'Amit Patel', AssignedAmount: 4500, PaidAmount: 4500, IsSettled: true },
      { ParticipantName: 'Priya Sharma', AssignedAmount: 4500, PaidAmount: 4500, IsSettled: true }
    ]
  }
];
fs.writeFileSync(path.join(expDir, 'Group expenses.json'), JSON.stringify(groups, null, 2), 'utf8');

const zipPath = path.join(__dirname, 'gpay_takeout_dummy.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// Compress with powershell
const takeoutDir = path.join(gpayDir, 'Takeout');
execSync(`powershell -Command "Compress-Archive -Path '${takeoutDir}' -DestinationPath '${zipPath}' -Force"`);
fs.rmSync(gpayDir, { recursive: true, force: true });

console.log('Created ' + zipPath);
