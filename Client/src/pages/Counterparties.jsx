import { useEffect, useState } from "react";
import api from "../api/client";

export default function Counterparties() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/counterparties/1")
      .then(res => {
        setData([res.data]);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <div className="loader-text">Loading counterparties...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ marginBottom: 0 }}>Counterparties</h1>
        <div className="badge blue" style={{ padding: '10px 18px', fontSize: '13px', fontWeight: 700 }}>
          {data.length} Total Counterparties
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>UPI IDs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map(cp => (
              <tr key={cp.id}>
                <td style={{ fontWeight: 700, color: "#111827" }}>{cp.friendlyName}</td>
                <td>
                  {cp.category ? (
                    <span className="badge purple" style={{ textTransform: 'capitalize' }}>
                      {cp.category}
                    </span>
                  ) : "-"}
                </td>
                <td style={{ fontFamily: 'monospace', color: '#4b5563', fontSize: '13px' }}>{cp.upiIds?.join(", ") || "-"}</td>
                <td><span className="badge green">Active</span></td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontStyle: 'italic' }}>
                  No counterparties found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
