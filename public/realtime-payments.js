// public/realtime-payments.js

document.addEventListener('DOMContentLoaded', () => {
    // Connect to the WebSocket server
    const socket = io();

    // Get the container element where we will render the records
    const recordsContainer = document.getElementById('records-container');

    // Helper function to render the full HTML content
    function renderRecords(transferIn, transferOut) {
        // This function builds the HTML content for both tables
        // You can use a template literal for a clean way to generate HTML
        recordsContainer.innerHTML = `
          <div class="mb-8">
            <h2 class="text-2xl font-semibold mb-4 text-green-700">Incoming Transfers (In)</h2>
            <div class="overflow-x-auto bg-white shadow rounded-lg">
              <table class="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr class="bg-gray-100">
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction ID</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount (UGX)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${transferIn.map(record => `
                    <tr>
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${record.transactionId}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-green-600">${record.total_amount.toLocaleString('en-UG')}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${record.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">
                          ${record.status}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(record.createdAt).toLocaleString()}</td>
                    </tr>
                  `).join('')}
                  ${transferIn.length === 0 ? `<tr><td colspan="4" class="py-4 text-center text-gray-500">No incoming transfer records found.</td></tr>` : ''}
                </tbody>
              </table>
            </div>
          </div>
          
          <div class="mb-8">
            <h2 class="text-2xl font-semibold mb-4 text-red-700">Outgoing Transfers (Out)</h2>
            <div class="overflow-x-auto bg-white shadow rounded-lg">
              <table class="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr class="bg-gray-100">
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction ID</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount (UGX)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${transferOut.map(record => `
                    <tr>
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${record.transactionId}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-red-600">${record.disbursement_amount.toLocaleString('en-UG')}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${record.status === 'DISBURSEMENT_COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                          ${record.status}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(record.createdAt).toLocaleString()}</td>
                    </tr>
                  `).join('')}
                  ${transferOut.length === 0 ? `<tr><td colspan="4" class="py-4 text-center text-gray-500">No outgoing transfer records found.</td></tr>` : ''}
                </tbody>
              </table>
            </div>
          </div>
        `;
    }

    // Initial render with data passed from the server (if available)
    const initialTransferIn = JSON.parse(document.getElementById('initial-transfer-in-data')?.textContent || '[]');
    const initialTransferOut = JSON.parse(document.getElementById('initial-transfer-out-data')?.textContent || '[]');
    renderRecords(initialTransferIn, initialTransferOut);

    // Listen for real-time updates from the server
    socket.on('paymentUpdate', async (change) => {
        console.log('Received real-time update:', change);
        
        // This is a simplified approach. In a production app, you would
        // use the change event to update the specific record without re-fetching all data.
        // For this example, we will just reload the data.
        const response = await fetch('/api/payments/records');
        const data = await response.json();
        renderRecords(data.transferInRecords, data.transferOutRecords);
    });
});
