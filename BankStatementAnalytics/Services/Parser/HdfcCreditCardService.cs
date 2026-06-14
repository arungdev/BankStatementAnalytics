using BankStatementAnalytics.Models;
using Common.Framework.Data;
using Common.Framework.Logging;

namespace BankStatementAnalytics.Services.Parser
{
    public class HdfcCreditCardService
    {
        private readonly HdfcCreditCardParser _parser;

        public HdfcCreditCardService(CounterPartyService counterPartyService)
        {
            _parser = new HdfcCreditCardParser(counterPartyService);
        }

        public async Task<int> ExtractAsync(string filePath, int accountId, Guid uploadId)
        {
            try
            {
                var text = await File.ReadAllTextAsync(filePath);
                var transactions = _parser.Parse(text, accountId)
                                          .Cast<BankTransaction>()
                                          .ToList();

                int saved = 0;
                foreach (var tx in transactions)
                {
                    try
                    {
                        tx.UploadId = uploadId;
                        await DbHelper.SaveAsync(tx);
                        saved++;
                    }
                    catch (Exception ex)
                    {
                        // Duplicate — composite key (AccountId, BankReference, BankType)
                        Log.Error($"Skipping duplicate CC tx: {tx.BankReference}", ex);
                    }
                }

                Log.Info($"HDFC CC: saved {saved}/{transactions.Count} for account {accountId}");
                return saved;
            }
            catch (Exception ex)
            {
                Log.Exception(ex);
                throw;
            }
        }
    }
}