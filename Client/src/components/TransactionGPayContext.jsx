import { FiSmartphone } from 'react-icons/fi';
import { getGPayContext } from '../utils/gpayContext';
import { maskName } from '../utils/format';
import { usePrivacy } from '../context/usePrivacy';
import './TransactionGPayContext.css';

export default function TransactionGPayContext({ note, detail = false }) {
  const { maskAmounts } = usePrivacy();
  const context = getGPayContext(note);
  if (context.length === 0) return null;
  if (!detail) return <span className="tx-gpay-badge" title="GPay export information is attached to this transaction"><FiSmartphone size={11} aria-hidden="true" />GPay</span>;
  return <section className="tx-gpay-context" aria-label="GPay information">
    <div className="tx-gpay-context-heading"><span className="tx-gpay-badge"><FiSmartphone size={12} aria-hidden="true" />GPay</span><strong>Payment context</strong></div>
    {context.map((item, index) => <div className="tx-gpay-context-record" key={index}><p>{maskAmounts ? 'Hidden in privacy mode' : maskName(item.text)}</p>{item.sourceId && <dl><dt>GPay activity ID</dt><dd>{maskAmounts ? 'Hidden in privacy mode' : maskName(item.sourceId)}</dd></dl>}</div>)}
    <small>GPay information stored with this transaction. Activity IDs are separate from bank references.</small>
  </section>;
}
