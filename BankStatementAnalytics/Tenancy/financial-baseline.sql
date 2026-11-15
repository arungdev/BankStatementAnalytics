create table Accounts (Id  bigserial, OwnerUserId int8, AccountNumber varchar(50) not null, AccountHolderName varchar(255), BankName int4, BranchCode varchar(255), CreditLimit decimal(19,5), StatementDay int4, SharedLimitAccountId int8, WatchFolderPath varchar(1000), WatchEnabled boolean, StatementPassword varchar(2000), primary key (Id))
-- cf:statement --
create table MerchantUpis (Id  serial, CounterPartyId int4 not null, UpiId varchar(100) not null, CreatedOn timestamp, primary key (Id))
-- cf:statement --
create table Merchant (Id  serial, OwnerUserId int8, Name varchar(250) not null, FriendlyName varchar(250), Category varchar(100), SubCategory varchar(100), ShiftToNextMonth boolean, BankCode varchar(20), Notes varchar(500), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table CounterPartyAliases (CounterPartyId int4 not null, AliasName varchar(255))
-- cf:statement --
create table MerchantAccounts (CounterPartyId int4 not null, AccountId int8)
-- cf:statement --
create table Bank_Transactions (AccountId int8 not null, BankReference varchar(255) not null, TransactionType varchar(10) not null, BankType varchar(10) not null, TransactionDate timestamp, ValueDate timestamp, EffectiveDate timestamp, Description varchar(2000), Amount decimal(19,5), Debit decimal(19,5), Credit decimal(19,5), Balance decimal(19,5), ImportedOn timestamp, UploadId varchar(50), UpiReference varchar(50), BankCode varchar(20), Mode varchar(50), CounterPartyId int4, Narration varchar(2000), ChequeNumber varchar(50), CustomerReference varchar(100), UpiVpa varchar(255), TransferGroupId varchar(50), CategoryOverride varchar(255), SubCategoryOverride varchar(255), Tags varchar(255), Note varchar(2000), OriginalCurrency varchar(10), OriginalAmount decimal(19,5), ForexMarkupPercent decimal(19,5), primary key (AccountId, BankReference, TransactionType, BankType))
-- cf:statement --
create table Uploads (Id varchar(255) not null, FileName varchar(500), StoredName varchar(500), AccountId int4, Path varchar(1000), UploadedAt timestamp, TransactionId varchar(50), FileHash varchar(64), TotalCount int4, NewCount int4, ImportStatus varchar(20), ImportWarnings text, AutoImported boolean, primary key (Id))
-- cf:statement --
create table ImportHistory (Id varchar(255) not null, AccountId int4, FileName varchar(500), SourcePath varchar(1000), Status varchar(20), Error varchar(2000), CreatedAt timestamp, UploadId varchar(50), primary key (Id))
-- cf:statement --
create table CardStatementSummaries (Id  bigserial, AccountId int8, UploadId uuid, StatementDate timestamp, PeriodStart timestamp, PeriodEnd timestamp, PaymentDueDate timestamp, TotalDue decimal(19,5), MinimumDue decimal(19,5), CreditLimit decimal(19,5), AvailableCreditLimit decimal(19,5), RewardPointsBalance int4, CreatedAt timestamp, primary key (Id))
-- cf:statement --
create table UploadTransactions (Id varchar(255) not null, UploadId varchar(50), Amount decimal(19,5), Description varchar(1000), CreatedAt timestamp, primary key (Id))
-- cf:statement --
create table Categories (Id  serial, OwnerUserId int8, Name varchar(250) not null, primary key (Id))
-- cf:statement --
create table SubCategories (Id  serial, Name varchar(250) not null, CategoryId int4 not null, primary key (Id))
-- cf:statement --
create table Tags (Id  bigserial, OwnerUserId int8, Name varchar(100), primary key (Id))
-- cf:statement --
create table RecurringBills (Id  serial, OwnerUserId int8, Name varchar(250) not null, MatchKey varchar(500) not null, CounterPartyId int4, ExpectedAmount decimal(19,5), DueDayOfMonth int4, Cadence varchar(20), Status varchar(20), LastSeenDate timestamp, CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table Budgets (Id  serial, OwnerUserId int8, Category varchar(250) not null, MonthlyLimit decimal(19,5), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table Deposits (Id  serial, OwnerUserId int8, Kind varchar(4) not null, MatchKey varchar(500) not null, Nickname varchar(250), InterestRate decimal(19,5), MaturityDate timestamp, TermMonths int4, Note varchar(1000), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table SavingsGoals (Id  serial, OwnerUserId int8, Name varchar(250) not null, TargetAmount decimal(19,5), CurrentSaved decimal(19,5), TargetDate timestamp, Category varchar(100), Notes varchar(1000), Status varchar(50), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table CategorizationRules (Id  serial, OwnerUserId int8, Name varchar(250) not null, Priority int4, Enabled boolean, NarrationContains varchar(500), NarrationRegex varchar(500), MinAmount decimal(19,5), MaxAmount decimal(19,5), ModeEquals varchar(50), BankEquals varchar(50), SetCategory varchar(250), SetSubCategory varchar(250), SetTags varchar(500), SetNote varchar(1000), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table TransactionSplits (Id  serial, OwnerUserId int8, ParentAccountId int8, ParentBankReference varchar(100) not null, ParentBankType varchar(50) not null, Amount decimal(19,5), Category varchar(250), SubCategory varchar(250), Note varchar(1000), CreatedOn timestamp, primary key (Id))
-- cf:statement --
create table Split_Groups (Id  serial, OwnerUserId int8, GroupUid varchar(50), Title varchar(250) not null, SourceKey varchar(64), GPayProfileId varchar(64), GPayOwnerName varchar(250), SourceState varchar(50), CreatorName varchar(250), SourceSnapshot text, SourceImportedUtc timestamp, Description varchar(1000), Date timestamp, TotalAmount decimal(19,5), UserShareAmount decimal(19,5), SettledAmount decimal(19,5), Status varchar(50), Confidence varchar(50), SplitType varchar(50), BillGroupId int4, GroupName varchar(250), ParentAccountId int8, ParentBankReference varchar(100), ParentBankType varchar(50), ParentTransactionType varchar(10), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table Split_Group_Members (Id  serial, OwnerUserId int8, SplitGroupId int4 not null, ParticipantName varchar(250) not null, ParticipantVpa varchar(255), AssignedAmount decimal(19,5), PaidAmount decimal(19,5), IsSettled boolean, IsUser boolean, LinkedAccountId int8, LinkedBankReference varchar(100), LinkedBankType varchar(50), LinkedTransactionType varchar(10), SourceState varchar(50), SettlementEvidence varchar(50), Notes varchar(1000), CreatedOn timestamp, primary key (Id))
-- cf:statement --
create table gpay_evidence_records (Id  serial, OwnerUserId int8, Kind varchar(40), SourceKey varchar(64), Payload text, CreatedUtc timestamp, primary key (Id))
-- cf:statement --
create table gpay_settlement_allocations (Id  serial, OwnerUserId int8, SplitId int4, MemberId int4, AccountId int8, BankReference varchar(100), BankType varchar(50), TransactionType varchar(10), Amount decimal(19,5), CreatedUtc timestamp, primary key (Id))
-- cf:statement --
create table Bill_Groups (Id  serial, OwnerUserId int8, Name varchar(250) not null, GPayProfileId varchar(64), Description varchar(1000), CreatedOn timestamp, UpdatedOn timestamp, primary key (Id))
-- cf:statement --
create table Bill_Group_Members (Id  serial, OwnerUserId int8, BillGroupId int4 not null, Name varchar(250) not null, Vpa varchar(255), CreatedOn timestamp, primary key (Id))
-- cf:statement --
create index IX_Accounts_OwnerUserId on Accounts (OwnerUserId)
-- cf:statement --
create index IX_MerchantUpis_CounterPartyId on MerchantUpis (CounterPartyId)
-- cf:statement --
create index IX_MerchantUpis_UpiId on MerchantUpis (UpiId)
-- cf:statement --
alter table MerchantUpis add constraint FK_865033CB foreign key (CounterPartyId) references Merchant deferrable initially deferred
-- cf:statement --
create index IX_Merchant_OwnerUserId on Merchant (OwnerUserId)
-- cf:statement --
create index IX_Merchant_Name_BankCode on Merchant (Name, BankCode)
-- cf:statement --
create index IX_CounterPartyAliases_AliasName on CounterPartyAliases (AliasName)
-- cf:statement --
alter table CounterPartyAliases add constraint FK_85A91AF9 foreign key (CounterPartyId) references Merchant deferrable initially deferred
-- cf:statement --
create index IX_MerchantAccounts_AccountId on MerchantAccounts (AccountId)
-- cf:statement --
alter table MerchantAccounts add constraint FK_67B20968 foreign key (CounterPartyId) references Merchant deferrable initially deferred
-- cf:statement --
create index IX_BankTransactions_Account_Date on Bank_Transactions (AccountId, TransactionDate)
-- cf:statement --
create index IX_BankTransactions_UploadId on Bank_Transactions (UploadId)
-- cf:statement --
create index IX_BankTransactions_CounterPartyId on Bank_Transactions (CounterPartyId)
-- cf:statement --
create index IX_BankTransactions_TransferGroupId on Bank_Transactions (TransferGroupId)
-- cf:statement --
alter table Bank_Transactions add constraint FK_46DCB1E3 foreign key (CounterPartyId) references Merchant deferrable initially deferred
-- cf:statement --
create index IX_Uploads_FileHash on Uploads (FileHash)
-- cf:statement --
create index IX_ImportHistory_AccountId on ImportHistory (AccountId)
-- cf:statement --
create index IX_CardStatementSummaries_AccountId on CardStatementSummaries (AccountId)
-- cf:statement --
create index IX_UploadTransactions_UploadId on UploadTransactions (UploadId)
-- cf:statement --
create index IX_Categories_OwnerUserId on Categories (OwnerUserId)
-- cf:statement --
alter table SubCategories add constraint FK_2148EAA4 foreign key (CategoryId) references Categories deferrable initially deferred
-- cf:statement --
create index IX_Tags_OwnerUserId on Tags (OwnerUserId)
-- cf:statement --
create index IX_RecurringBills_OwnerUserId on RecurringBills (OwnerUserId)
-- cf:statement --
create index IX_RecurringBills_CounterPartyId on RecurringBills (CounterPartyId)
-- cf:statement --
alter table RecurringBills add constraint FK_805D9587 foreign key (CounterPartyId) references Merchant deferrable initially deferred
-- cf:statement --
create index IX_Budgets_OwnerUserId on Budgets (OwnerUserId)
-- cf:statement --
create index IX_Deposits_OwnerUserId on Deposits (OwnerUserId)
-- cf:statement --
create index IX_SavingsGoals_OwnerUserId on SavingsGoals (OwnerUserId)
-- cf:statement --
create index IX_CategorizationRules_OwnerUserId on CategorizationRules (OwnerUserId)
-- cf:statement --
create index IX_TransactionSplits_OwnerUserId on TransactionSplits (OwnerUserId)
-- cf:statement --
create index IX_TransactionSplits_Parent on TransactionSplits (ParentAccountId, ParentBankReference)
-- cf:statement --
create index IX_SplitGroups_OwnerUserId on Split_Groups (OwnerUserId)
-- cf:statement --
create index IX_SplitGroups_GroupUid on Split_Groups (GroupUid)
-- cf:statement --
create index IX_SplitGroups_Date on Split_Groups (Date)
-- cf:statement --
create index IX_SplitGroups_BillGroupId on Split_Groups (BillGroupId)
-- cf:statement --
alter table Split_Groups add constraint FK_7EDB74E1 foreign key (BillGroupId) references Bill_Groups deferrable initially deferred
-- cf:statement --
create index IX_SplitGroupMembers_OwnerUserId on Split_Group_Members (OwnerUserId)
-- cf:statement --
create index IX_SplitGroupMembers_SplitGroupId on Split_Group_Members (SplitGroupId)
-- cf:statement --
alter table Split_Group_Members add constraint FK_B07E15F6 foreign key (SplitGroupId) references Split_Groups deferrable initially deferred
-- cf:statement --
create index IX_BillGroups_OwnerUserId on Bill_Groups (OwnerUserId)
-- cf:statement --
create index IX_BillGroupMembers_OwnerUserId on Bill_Group_Members (OwnerUserId)
-- cf:statement --
create index IX_BillGroupMembers_GroupId on Bill_Group_Members (BillGroupId)
-- cf:statement --
alter table Bill_Group_Members add constraint FK_CE45E03E foreign key (BillGroupId) references Bill_Groups deferrable initially deferred
-- cf:statement --
create index if not exists ix_banktransactions_account_effectivedate on bank_transactions(accountid,coalesce(effectivedate,transactiondate))