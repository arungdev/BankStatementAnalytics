import { useEffect, useState } from 'react';
import {
  FiCompass, FiCreditCard, FiUploadCloud, FiRepeat, FiTrendingUp, FiTarget,
} from 'react-icons/fi';
import Modal from './ui/Modal';
import Button from './ui/Button';
import './OnboardingGuide.css';

const STEPS = [
  {
    icon: FiCompass,
    title: 'Welcome to Bank Analytics 👋',
    text: 'Turn your bank statements into clear spending insights. This one-minute guide walks you through getting started — you can reopen it anytime from the ? button in the header.',
  },
  {
    icon: FiCreditCard,
    title: '1 · Add a bank account',
    text: 'Everything starts with an account — one for each bank or credit card you want to track.',
    points: [
      'Use the “+ Add” button in the account filter, or Settings → Accounts.',
      'Supported banks: HDFC, HDFC Credit Card, and IOB.',
      'For credit cards you can also set the credit limit and statement day.',
    ],
  },
  {
    icon: FiUploadCloud,
    title: '2 · Upload a statement',
    text: 'Download a statement from your bank and drop it on the Upload page.',
    points: [
      'PDF, CSV, or TXT — the page shows which formats your bank supports.',
      'Password-protected PDFs work; you’ll be asked for the password.',
      'Duplicates are skipped automatically, so re-uploading is always safe.',
    ],
  },
  {
    icon: FiRepeat,
    title: '3 · Review transactions',
    text: 'Imported transactions are categorized automatically by merchant.',
    points: [
      'Transactions — filter by date, re-categorize, add tags and notes.',
      'Merchants — rename, merge duplicates, set default categories.',
      'A category set on a transaction wins over the merchant’s default.',
    ],
  },
  {
    icon: FiTrendingUp,
    title: '4 · Explore your money',
    text: 'The dashboard pages fill in as soon as data is imported.',
    points: [
      'Overview — your finances at a glance.',
      'Trends & Insights — income vs. spends, category and merchant breakdowns.',
      'Reports — monthly / yearly summaries, exportable as PDF.',
    ],
  },
  {
    icon: FiTarget,
    title: '5 · Plan ahead',
    text: 'Stay on top of what’s coming next.',
    points: [
      'Budgets — monthly limits per category, with suggested amounts.',
      'Bills — recurring bills and due reminders, including credit-card bills.',
      'Investments — track deposits and maturity dates.',
    ],
  },
];

/**
 * OnboardingGuide — step-by-step "how to use the app" tour.
 * Shown automatically on a user's first login (see Layout in App.jsx) and
 * reopenable from the header help button.
 *
 * Props:
 *   open         — modal visibility
 *   onClose      — called on skip / finish / ×; caller persists the seen flag
 *   hasAccounts  — when false, the final CTA opens the Add Account modal
 *   onAddAccount — opens the Add Account modal (used by the final CTA)
 */
export default function OnboardingGuide({ open, onClose, hasAccounts, onAddAccount }) {
  const [step, setStep] = useState(0);

  // Restart from the first step whenever the guide is reopened.
  useEffect(() => { if (open) setStep(0); }, [open]);

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    onClose();
    if (!hasAccounts) onAddAccount?.();
  };

  return (
    <Modal open={open} onClose={onClose} width={520} footer={
      <div className="og-footer">
        {!isLast
          ? <button className="btn ghost small" onClick={onClose}>Skip tour</button>
          : <span />}
        <div className="og-dots" role="tablist" aria-label="Guide steps">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              className={`og-dot${i === step ? ' active' : ''}`}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}`}
              aria-current={i === step}
            />
          ))}
        </div>
        <div className="og-nav">
          {step > 0 && (
            <Button className="small" onClick={() => setStep(s => s - 1)}>Back</Button>
          )}
          {isLast
            ? <Button variant="primary" className="small" onClick={finish}>
                {hasAccounts ? 'Get started' : 'Add my first account'}
              </Button>
            : <Button variant="primary" className="small" onClick={() => setStep(s => s + 1)}>Next</Button>}
        </div>
      </div>
    }>
      <div className="og-body">
        <div className="og-icon"><Icon size={26} /></div>
        <h3 className="og-title">{current.title}</h3>
        <p className="og-text">{current.text}</p>
        {current.points && (
          <ul className="og-points">
            {current.points.map(p => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
