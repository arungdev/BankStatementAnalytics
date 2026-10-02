using System.Threading.Tasks;
using BankStatementAnalytics.Services;
using Common.Framework.Web;
using Microsoft.AspNetCore.Mvc;

namespace BankStatementAnalytics.Controllers.Api
{
    [ApiController]
    [Route("api/split-groups")]
    public class SplitGroupsApiController : TenantControllerBase
    {
        private readonly GPaySplitService _splitService;

        public SplitGroupsApiController(GPaySplitService splitService)
        {
            _splitService = splitService;
        }

        // GET: api/split-groups — confirmed/created split groups
        [HttpGet]
        public async Task<IActionResult> GetGroups()
        {
            var groups = await _splitService.GetGroupsAsync(CurrentUserId);
            return Ok(groups);
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

            var linked = await _splitService.LinkTransactionToMemberAsync(CurrentUserId, id, memberId, request);
            return linked != null ? Ok(linked) : NotFound();
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
    }
}
