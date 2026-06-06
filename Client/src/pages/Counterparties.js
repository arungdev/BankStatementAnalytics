import { useEffect, useState } from "react";
import api from "../api/client";

export default function Counterparties() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ideally this should fetch ALL counterparties, currently api says /counterparties/1
    // Update if the backend has a /counterparties endpoint for listing all.
    api.get("/counterparties/1")
      .then(res => {
        setData([res.data]); // Wrapping in array since it's a single object for now
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
        <div className="badge blue" style={{ padding: '8px 16px', fontSize: '14px' }}>
          {data.length} Total
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
                <td style={{ fontWeight: 600, color: "#111827" }}>{cp.friendlyName}</td>
                <td>
                  {cp.category ? (
                    <span className="badge" style={{ background: '#f3e8ff', color: '#7e22ce' }}>
                      {cp.category}
                    </span>
                  ) : "-"}
                </td>
                <td style={{ fontFamily: 'monospace', color: '#4b5563' }}>{cp.upiIds?.join(", ") || "-"}</td>
                <td><span className="badge blue">Active</span></td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
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
