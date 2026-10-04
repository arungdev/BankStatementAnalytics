using System.Threading.Tasks;
using BankStatementAnalytics.Services;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [TypeFilter(typeof(GPayValidationFilter))]
    [Route("api/split-groups")]
    public class SplitGroupsApiController : TenantControllerBase
    {
        private readonly GPaySplitService _splitService;
        private readonly GPayTakeoutService _takeoutService;

        public SplitGroupsApiController(GPaySplitService splitService, GPayTakeoutService takeoutService)
        {
            _splitService = splitService;
            _takeoutService = takeoutService;
        }

        // GET: api/split-groups — confirmed/created split groups
        [HttpGet]
        public async Task<IActionResult> GetGroups([FromQuery] string? filter = null)
        {
            var groups = await _splitService.GetGroupsAsync(CurrentUserId);
            if (!string.IsNullOrWhiteSpace(filter))
            {
                if (filter.Equals("created_by_me", System.StringComparison.OrdinalIgnoreCase))
                {
                    groups = groups.Where(g => g.IsCreatedByUser).ToList();
                }
                else if (filter.Equals("included", System.StringComparison.OrdinalIgnoreCase))
                {
                    groups = groups.Where(g => g.IsUserInvolved).ToList();
                }
            }
            return Ok(groups);
        }

        // Current split balances, optionally scoped by a linked bank account and bill date.
        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary([FromQuery] long accountId = 0,
            [FromQuery] System.DateTime? startDate = null, [FromQuery] System.DateTime? endDate = null)
        {
            if (startDate.HasValue && endDate.HasValue && startDate.Value.Date > endDate.Value.Date)
                return BadRequest("Start date must be on or before end date.");
            HashSet<long>? scope = null;
            if (accountId != 0)
            {
                var owned = await AccountAccess.OwnedIdSetAsync(CurrentUserId);
                if (!owned.Contains(accountId)) return NotFound();
                scope = new HashSet<long> { accountId };
            }
            return Ok(await _splitService.GetSharedBillSummaryAsync(CurrentUserId, scope, startDate, endDate));
        }

        [HttpGet("transaction-context")]
        public async Task<IActionResult> GetTransactionContext([FromQuery] long accountId,
            [FromQuery] string bankReference, [FromQuery] string bankType, [FromQuery] string transactionType)
        {
            if (accountId <= 0 || string.IsNullOrWhiteSpace(bankReference) || string.IsNullOrWhiteSpace(bankType) || string.IsNullOrWhiteSpace(transactionType))
                return BadRequest("A complete bank transaction key is required.");
            var context = await _splitService.GetSharedBillTransactionContextAsync(CurrentUserId,
                accountId, bankReference, bankType, transactionType);
            return context == null ? NotFound() : Ok(context);
        }

        // GET: api/split-groups/suggestions — auto-detected GPay / UPI split candidate clusters
        [HttpGet("suggestions")]
        public IActionResult GetSuggestions()
        {
            var suggestions = _splitService.DetectCandidates(CurrentUserId);
            return Ok(suggestions);
        }

        // GET: api/split-groups/transactions — candidate transactions for selecting bill or repayment
        [HttpGet("transactions")]
        public async Task<IActionResult> GetCandidateTransactions(
            [FromQuery] string? type = null,
            [FromQuery] string? search = null,
            [FromQuery] int limit = 50)
        {
            var txs = await _splitService.GetCandidateTransactionsAsync(CurrentUserId, type, search, limit);
            return Ok(txs);
        }

        // GET: api/split-groups/{id}
        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetGroupById(int id)
        {
            var group = await _splitService.GetGroupByIdAsync(CurrentUserId, id);
            return group != null ? Ok(group) : NotFound();
        }

        // POST: api/split-groups — create manual split group or confirm an auto-detected suggestion
        [HttpPost]
        public async Task<IActionResult> CreateGroup([FromBody] CreateSplitGroupRequest request)
        {
            if (request == null)
                return BadRequest("Invalid request.");

            var created = await _splitService.CreateGroupAsync(CurrentUserId, request);
            return CreatedAtAction(nameof(GetGroupById), new { id = created.Id }, created);
        }

        // PUT: api/split-groups/{id} — update group info (title, total, user share, status)
        [HttpPut("{id:int}")]
        public async Task<IActionResult> UpdateGroup(int id, [FromBody] UpdateSplitGroupRequest request)
        {
            if (request == null)
                return BadRequest("Invalid request.");

            var updated = await _splitService.UpdateGroupAsync(CurrentUserId, id, request);
            return updated != null ? Ok(updated) : NotFound();
        }

        // POST: api/split-groups/{id}/members — manually add participant and assign split amount
        [HttpPost("{id:int}/members")]
        public async Task<IActionResult> AddMember(int id, [FromBody] AddSplitMemberRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.ParticipantName))
                return BadRequest("Participant name is required.");

            var member = await _splitService.AddMemberAsync(CurrentUserId, id, request);
            return member != null ? Ok(member) : NotFound();
        }

        // PUT: api/split-groups/{id}/members/{memberId} — manually edit assigned split amount or settlement status
        [HttpPut("{id:int}/members/{memberId:int}")]
        public async Task<IActionResult> UpdateMember(int id, int memberId, [FromBody] UpdateSplitMemberRequest request)
        {
            if (request == null)
                return BadRequest("Invalid request.");

            var updated = await _splitService.UpdateMemberAsync(CurrentUserId, id, memberId, request);
            return updated != null ? Ok(updated) : NotFound();
        }

        // POST: api/split-groups/{id}/members/{memberId}/link-transaction — link bank transaction to participant's share
        [HttpPost("{id:int}/members/{memberId:int}/link-transaction")]
        public async Task<IActionResult> LinkTransaction(int id, int memberId, [FromBody] LinkTransactionRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.BankReference))
                return BadRequest("Transaction details are required.");

            try
            {
                var linked = await _splitService.LinkTransactionToMemberAsync(CurrentUserId, id, memberId, request);
                return linked != null ? Ok(linked) : NotFound();
            }
            catch (System.ArgumentException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        // POST: api/split-groups/{id}/members/{memberId}/unlink-transaction — unlink bank transaction
        [HttpPost("{id:int}/members/{memberId:int}/unlink-transaction")]
        public async Task<IActionResult> UnlinkTransaction(int id, int memberId)
        {
            var unlinked = await _splitService.UnlinkTransactionFromMemberAsync(CurrentUserId, id, memberId);
            return unlinked != null ? Ok(unlinked) : NotFound();
        }

        // DELETE: api/split-groups/{id}/members/{memberId} — remove participant
        [HttpDelete("{id:int}/members/{memberId:int}")]
        public async Task<IActionResult> DeleteMember(int id, int memberId)
        {
            var deleted = await _splitService.DeleteMemberAsync(CurrentUserId, id, memberId);
            return deleted ? NoContent() : NotFound();
        }

        // DELETE: api/split-groups/{id} — delete entire split group
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> DeleteGroup(int id)
        {
            var deleted = await _splitService.DeleteGroupAsync(CurrentUserId, id);
            return deleted ? NoContent() : NotFound();
        }

        // ────────────────────────────────────────────────────────────────────
        // PARTICIPANT SUGGESTIONS
        // ────────────────────────────────────────────────────────────────────

        // GET: api/split-groups/participants/suggest — smart suggestions from contacts & previous splits
        [HttpGet("participants/suggest")]
        public async Task<IActionResult> GetParticipantSuggestions([FromQuery] string? q = null, [FromQuery] int limit = 20)
        {
            var suggestions = await _splitService.GetParticipantSuggestionsAsync(CurrentUserId, q, limit);
            return Ok(suggestions);
        }

        // ────────────────────────────────────────────────────────────────────
        // PERSISTENT GPAY BILL GROUPS
        // ────────────────────────────────────────────────────────────────────

        // GET: api/split-groups/bill-groups — all persistent bill groups with members, splits, and owed balances
        [HttpGet("bill-groups")]
        public async Task<IActionResult> GetBillGroups()
        {
            var groups = await _splitService.GetBillGroupsAsync(CurrentUserId);
            return Ok(groups);
        }

        // GET: api/split-groups/bill-groups/{id:int}
        [HttpGet("bill-groups/{id:int}")]
        public async Task<IActionResult> GetBillGroupById(int id)
        {
            var group = await _splitService.GetBillGroupByIdAsync(CurrentUserId, id);
            return group != null ? Ok(group) : NotFound();
        }

        // POST: api/split-groups/bill-groups — create persistent bill group with initial members
        [HttpPost("bill-groups")]
        public async Task<IActionResult> CreateBillGroup([FromBody] CreateBillGroupRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Name))
                return BadRequest("Group name is required.");

            var created = await _splitService.CreateBillGroupAsync(CurrentUserId, request);
            return CreatedAtAction(nameof(GetBillGroupById), new { id = created.Id }, created);
        }

        // PUT: api/split-groups/bill-groups/{id:int} — update group name or description
        [HttpPut("bill-groups/{id:int}")]
        public async Task<IActionResult> UpdateBillGroup(int id, [FromBody] UpdateBillGroupRequest request)
        {
            if (request == null)
                return BadRequest("Invalid request.");

            var updated = await _splitService.UpdateBillGroupAsync(CurrentUserId, id, request);
            return updated != null ? Ok(updated) : NotFound();
        }

        // DELETE: api/split-groups/bill-groups/{id:int} — delete group (unlinks splits)
        [HttpDelete("bill-groups/{id:int}")]
        public async Task<IActionResult> DeleteBillGroup(int id)
        {
            var deleted = await _splitService.DeleteBillGroupAsync(CurrentUserId, id);
            return deleted ? NoContent() : NotFound();
        }

        // POST: api/split-groups/bill-groups/{id:int}/members — add member to group
        [HttpPost("bill-groups/{id:int}/members")]
        public async Task<IActionResult> AddBillGroupMember(int id, [FromBody] AddBillGroupMemberRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Name))
                return BadRequest("Member name is required.");

            var member = await _splitService.AddBillGroupMemberAsync(CurrentUserId, id, request);
            return member != null ? Ok(member) : NotFound();
        }

        // DELETE: api/split-groups/bill-groups/{id:int}/members/{memberId:int} — remove member from group
        [HttpDelete("bill-groups/{id:int}/members/{memberId:int}")]
        public async Task<IActionResult> RemoveBillGroupMember(int id, int memberId)
        {
            var deleted = await _splitService.RemoveBillGroupMemberAsync(CurrentUserId, id, memberId);
            return deleted ? NoContent() : NotFound();
        }

        // ────────────────────────────────────────────────────────────────────
        // GOOGLE PAY TAKEOUT IMPORT
        // ────────────────────────────────────────────────────────────────────

        // GET: api/split-groups/import-takeout/status — check if local takeout file is available
        [HttpGet("import-takeout/status")]
        public IActionResult GetLocalTakeoutStatus()
        {
            const string defaultPath = @"D:\BankStatements\Gpay\takeout-20261003T045601Z-1-001.zip";
            var exists = System.IO.File.Exists(defaultPath);
            long size = 0;
            if (exists)
            {
                try { size = new System.IO.FileInfo(defaultPath).Length; } catch { }
            }

            return Ok(new
            {
                localFileDetected = exists,
                defaultPath = defaultPath,
                fileSizeBytes = size
            });
        }

        // POST: api/split-groups/import-takeout — upload Takeout .zip or Group expenses.json
        [HttpPost("import-takeout")]
        [RequestSizeLimit(250_000_000)]
        public async Task<IActionResult> ImportTakeout([FromForm] Microsoft.AspNetCore.Http.IFormFile? file, [FromForm] string? filePath = null, [FromForm] string? expectedArchiveHash = null)
        {
            if (file != null && file.Length > 0)
            {
                await using var stream = file.OpenReadStream();
                var result = await _takeoutService.ImportFromStreamAsync(CurrentUserId, stream, file.FileName, expectedArchiveHash);
                return Ok(result);
            }

            var path = !string.IsNullOrWhiteSpace(filePath) ? filePath : @"D:\BankStatements\Gpay\takeout-20261003T045601Z-1-001.zip";
            if (System.IO.File.Exists(path))
            {
                var result = await _takeoutService.ImportFromPathAsync(CurrentUserId, path, expectedArchiveHash);
                return Ok(result);
            }

            return BadRequest(new { success = false, message = "No file uploaded or file not found at path." });
        }

        // POST: api/split-groups/import-takeout-path — import directly from server-side file path
        [HttpPost("import-takeout-path")]
        public async Task<IActionResult> ImportTakeoutFromPath([FromBody] ImportTakeoutPathRequest request)
        {
            var path = !string.IsNullOrWhiteSpace(request?.FilePath)
                ? request.FilePath
                : @"D:\BankStatements\Gpay\takeout-20261003T045601Z-1-001.zip";

            var result = await _takeoutService.ImportFromPathAsync(CurrentUserId, path, request?.ExpectedArchiveHash);
            return Ok(result);
        }

        // ────────────────────────────────────────────────────────────────────
        // GPAY AUTO-IMPORT / WATCH FOLDER CONFIGURATION & SWEEP
        // ────────────────────────────────────────────────────────────────────

        // GET: api/split-groups/auto-import — get GPay watch folder config and current stats
        [HttpGet("auto-import")]
        public async Task<IActionResult> GetAutoImportConfig()
        {
            var config = await _takeoutService.GetAutoImportConfigAsync(CurrentUserId);
            return Ok(config);
        }

        // PUT: api/split-groups/auto-import — update GPay watch folder path and enabled status
        [HttpPut("auto-import")]
        public async Task<IActionResult> UpdateAutoImportConfig([FromBody] UpdateGPayAutoImportRequest request)
        {
            if (request == null)
                return BadRequest("Invalid request.");

            var config = await _takeoutService.UpdateAutoImportConfigAsync(CurrentUserId, request);
            return Ok(config);
        }

        // POST: api/split-groups/auto-import/sweep — trigger an immediate sweep of the GPay watch folder
        [HttpPost("auto-import/sweep")]
        public async Task<IActionResult> SweepAutoImport()
        {
            var result = await _takeoutService.SweepAsync(CurrentUserId);
            return Ok(result);
        }
    }

    public class ImportTakeoutPathRequest
    {
        public string? FilePath { get; set; }
        public string? ExpectedArchiveHash { get; set; }
    }
}
