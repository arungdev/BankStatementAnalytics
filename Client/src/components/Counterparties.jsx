import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Counterparties() {
  const [counterparties, setCounterparties] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get('http://localhost:5000/api/counterparties')
      .then(response => {
        setCounterparties(response.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching counterparties:', err);
        setError('Failed to load counterparties.');
        setLoading(false);
      });
  }, []);

  const filteredCounterparties = counterparties.filter(cp => {
    if (!searchTerm) return true;
    
    const term = searchTerm.toLowerCase();
    // Safely check properties using the lowercase JSON keys
    const matchesName = cp.name?.toLowerCase().includes(term);
    const matchesCategory = cp.category?.toLowerCase().includes(term);
    
    const matchesUpi = cp.upiIds?.some(upi => upi?.toLowerCase().includes(term));

    return matchesName || matchesCategory || matchesUpi;
  });

  if (loading) return <div className="p-4">Loading counterparties...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-1">Counterparties</h1>
      <p className="text-gray-600 mb-4">{counterparties.length} Total Counterparties</p>
      
      <div className="mb-4">
        <input 
          type="text" 
          placeholder="Search counterparties..." 
          className="border p-2 rounded w-full max-w-md"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 border-b text-left">Name</th>
              <th className="px-4 py-2 border-b text-left">Category</th>
              <th className="px-4 py-2 border-b text-left">UPI IDs</th>
              <th className="px-4 py-2 border-b text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredCounterparties.length > 0 ? (
              filteredCounterparties.map(cp => (
                <tr key={cp.id} className="hover:bg-gray-50">
                  {/* Use cp.name (lowercase) as sent from ASP.NET API */}
                  <td className="px-4 py-2 border-b font-medium">{cp.name || '-'}</td>
                  <td className="px-4 py-2 border-b">{cp.category || '-'}</td>
                  <td className="px-4 py-2 border-b">
                    {cp.upiIds?.length > 0 ? (
                      cp.upiIds.join(', ')
                    ) : (
                      <span className="text-gray-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-2 border-b text-green-600">Active</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" className="px-4 py-4 text-center text-gray-500">
                  No counterparties found matching "{searchTerm}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}