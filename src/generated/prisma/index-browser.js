
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  name: 'name',
  email: 'email',
  password: 'password',
  role: 'role',
  passwordResetToken: 'passwordResetToken',
  passwordResetExpires: 'passwordResetExpires',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  whatsappSignature: 'whatsappSignature',
  whatsappSignatureDefault: 'whatsappSignatureDefault',
  companyId: 'companyId',
  rankingCategory: 'rankingCategory',
  lastBadgeSeenAt: 'lastBadgeSeenAt'
};

exports.Prisma.QuickReplyScalarFieldEnum = {
  id: 'id',
  shortcut: 'shortcut',
  title: 'title',
  body: 'body',
  order: 'order',
  companyId: 'companyId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VaultEmailChallengeScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  codeHash: 'codeHash',
  credentialId: 'credentialId',
  attempts: 'attempts',
  used: 'used',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt'
};

exports.Prisma.VaultTrustedSessionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt'
};

exports.Prisma.UserGoogleConnectionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  service: 'service',
  googleEmail: 'googleEmail',
  googleName: 'googleName',
  accessTokenEnc: 'accessTokenEnc',
  refreshTokenEnc: 'refreshTokenEnc',
  tokenExpiresAt: 'tokenExpiresAt',
  scopes: 'scopes',
  status: 'status',
  lastError: 'lastError',
  lastSyncAt: 'lastSyncAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CompanyScalarFieldEnum = {
  id: 'id',
  name: 'name',
  tradeName: 'tradeName',
  slug: 'slug',
  segment: 'segment',
  phone: 'phone',
  email: 'email',
  website: 'website',
  logoUrl: 'logoUrl',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  document: 'document',
  blingContactId: 'blingContactId',
  hasSystemAccess: 'hasSystemAccess',
  fullSystemAccess: 'fullSystemAccess',
  moduleWhatsapp: 'moduleWhatsapp',
  moduleCrm: 'moduleCrm',
  moduleTickets: 'moduleTickets',
  moduleAI: 'moduleAI',
  moduleGamificacao: 'moduleGamificacao',
  moduleProjetos: 'moduleProjetos',
  moduleCalendario: 'moduleCalendario',
  moduleEmailMarketing: 'moduleEmailMarketing',
  moduleEmailInbox: 'moduleEmailInbox',
  moduleProspeccao: 'moduleProspeccao',
  serpapiKey: 'serpapiKey',
  moduleClickup: 'moduleClickup',
  moduleCampanhas: 'moduleCampanhas',
  moduleBling: 'moduleBling',
  moduleRelatorioMarketing: 'moduleRelatorioMarketing',
  moduleLinks: 'moduleLinks',
  moduleInstagram: 'moduleInstagram',
  moduleEspacoCliente: 'moduleEspacoCliente',
  moduleVideos: 'moduleVideos',
  modoAtendimento: 'modoAtendimento',
  aiMonthlyQuota: 'aiMonthlyQuota',
  aiUsedThisMonth: 'aiUsedThisMonth',
  aiQuotaResetAt: 'aiQuotaResetAt',
  parentCompanyId: 'parentCompanyId',
  emailAiTriageAuto: 'emailAiTriageAuto',
  triggerOnly: 'triggerOnly',
  webhookToken: 'webhookToken'
};

exports.Prisma.CampaignScalarFieldEnum = {
  id: 'id',
  name: 'name',
  slug: 'slug',
  description: 'description',
  source: 'source',
  status: 'status',
  budget: 'budget',
  startDate: 'startDate',
  endDate: 'endDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  companyId: 'companyId'
};

exports.Prisma.TrackingLinkScalarFieldEnum = {
  id: 'id',
  code: 'code',
  label: 'label',
  destination: 'destination',
  destType: 'destType',
  clicks: 'clicks',
  isActive: 'isActive',
  ogTitle: 'ogTitle',
  ogDescription: 'ogDescription',
  ogImage: 'ogImage',
  createdAt: 'createdAt',
  campaignId: 'campaignId',
  companyId: 'companyId'
};

exports.Prisma.ClickEventScalarFieldEnum = {
  id: 'id',
  trackingLinkId: 'trackingLinkId',
  targetUrl: 'targetUrl',
  targetLabel: 'targetLabel',
  kind: 'kind',
  createdAt: 'createdAt'
};

exports.Prisma.LeadScalarFieldEnum = {
  id: 'id',
  name: 'name',
  phone: 'phone',
  email: 'email',
  source: 'source',
  status: 'status',
  notes: 'notes',
  value: 'value',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  pipeline: 'pipeline',
  pipelineStage: 'pipelineStage',
  externalId: 'externalId',
  wonAt: 'wonAt',
  lostAt: 'lostAt',
  website: 'website',
  instagram: 'instagram',
  facebook: 'facebook',
  address: 'address',
  city: 'city',
  segment: 'segment',
  hasWhatsapp: 'hasWhatsapp',
  diagnosis: 'diagnosis',
  diagnosisAt: 'diagnosisAt',
  diagnosisSource: 'diagnosisSource',
  diagnosisToken: 'diagnosisToken',
  diagnosisClickedAt: 'diagnosisClickedAt',
  attendanceStatus: 'attendanceStatus',
  expectedReturnAt: 'expectedReturnAt',
  clickupTaskId: 'clickupTaskId',
  isInternal: 'isInternal',
  companyId: 'companyId',
  campaignId: 'campaignId',
  trackingLinkId: 'trackingLinkId',
  promotedFromPipeline: 'promotedFromPipeline',
  promotedAt: 'promotedAt',
  promotedReason: 'promotedReason',
  promotedViaEmailCampaignId: 'promotedViaEmailCampaignId',
  fbc: 'fbc',
  fbp: 'fbp',
  eventSourceUrl: 'eventSourceUrl',
  clientIp: 'clientIp',
  clientUserAgent: 'clientUserAgent',
  conversationId: 'conversationId'
};

exports.Prisma.TagScalarFieldEnum = {
  id: 'id',
  name: 'name',
  color: 'color',
  order: 'order',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadTagScalarFieldEnum = {
  leadId: 'leadId',
  tagId: 'tagId',
  createdAt: 'createdAt'
};

exports.Prisma.CustomFieldDefScalarFieldEnum = {
  id: 'id',
  name: 'name',
  key: 'key',
  type: 'type',
  options: 'options',
  required: 'required',
  order: 'order',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadCustomValueScalarFieldEnum = {
  id: 'id',
  leadId: 'leadId',
  fieldId: 'fieldId',
  value: 'value',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CompanyCustomFieldDefScalarFieldEnum = {
  id: 'id',
  name: 'name',
  key: 'key',
  type: 'type',
  options: 'options',
  order: 'order',
  ownerCompanyId: 'ownerCompanyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CompanyCustomValueScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  fieldId: 'fieldId',
  value: 'value',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TaskScalarFieldEnum = {
  id: 'id',
  title: 'title',
  dueAt: 'dueAt',
  done: 'done',
  doneAt: 'doneAt',
  notes: 'notes',
  source: 'source',
  leadId: 'leadId',
  companyId: 'companyId',
  assigneeId: 'assigneeId',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadCommentScalarFieldEnum = {
  id: 'id',
  body: 'body',
  authorName: 'authorName',
  createdAt: 'createdAt',
  source: 'source',
  externalId: 'externalId',
  leadId: 'leadId'
};

exports.Prisma.PipelineStageConfigScalarFieldEnum = {
  id: 'id',
  pipeline: 'pipeline',
  name: 'name',
  color: 'color',
  order: 'order',
  isFinal: 'isFinal',
  outcome: 'outcome',
  companyId: 'companyId'
};

exports.Prisma.CompanyContactScalarFieldEnum = {
  id: 'id',
  name: 'name',
  phone: 'phone',
  isGroup: 'isGroup',
  role: 'role',
  hasAccess: 'hasAccess',
  notes: 'notes',
  createdAt: 'createdAt',
  companyId: 'companyId',
  userId: 'userId'
};

exports.Prisma.WhatsappInstanceScalarFieldEnum = {
  id: 'id',
  instanceName: 'instanceName',
  label: 'label',
  phone: 'phone',
  status: 'status',
  webhookUrl: 'webhookUrl',
  instanceToken: 'instanceToken',
  acceptGroups: 'acceptGroups',
  groupReceiver: 'groupReceiver',
  ownerUserId: 'ownerUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  companyId: 'companyId'
};

exports.Prisma.MessageScalarFieldEnum = {
  id: 'id',
  externalId: 'externalId',
  phone: 'phone',
  participantPhone: 'participantPhone',
  participantName: 'participantName',
  body: 'body',
  direction: 'direction',
  identifiedAs: 'identifiedAs',
  processed: 'processed',
  rawPayload: 'rawPayload',
  receivedAt: 'receivedAt',
  ack: 'ack',
  quotedId: 'quotedId',
  quotedBody: 'quotedBody',
  mediaBase64: 'mediaBase64',
  mediaType: 'mediaType',
  companyId: 'companyId',
  instanceId: 'instanceId',
  campaignId: 'campaignId',
  leadId: 'leadId',
  conversationId: 'conversationId',
  sentByUserId: 'sentByUserId',
  sentByAI: 'sentByAI',
  deletedAt: 'deletedAt',
  reactions: 'reactions'
};

exports.Prisma.KeywordRuleScalarFieldEnum = {
  id: 'id',
  keyword: 'keyword',
  mapTo: 'mapTo',
  matchMode: 'matchMode',
  priority: 'priority',
  createdAt: 'createdAt',
  companyId: 'companyId',
  campaignId: 'campaignId'
};

exports.Prisma.SettingScalarFieldEnum = {
  key: 'key',
  value: 'value'
};

exports.Prisma.WhatsappQuotaScalarFieldEnum = {
  id: 'id',
  instanceId: 'instanceId',
  day: 'day',
  count: 'count',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConversationScalarFieldEnum = {
  id: 'id',
  phone: 'phone',
  isGroup: 'isGroup',
  status: 'status',
  statusUpdatedAt: 'statusUpdatedAt',
  assigneeId: 'assigneeId',
  setorId: 'setorId',
  lastMessageAt: 'lastMessageAt',
  lastMessageBody: 'lastMessageBody',
  lastMessageDirection: 'lastMessageDirection',
  unreadCount: 'unreadCount',
  scheduledReturnAt: 'scheduledReturnAt',
  returnNote: 'returnNote',
  instanceId: 'instanceId',
  syncBlocked: 'syncBlocked',
  excludeFromGamification: 'excludeFromGamification',
  aiMode: 'aiMode',
  aiPausedAt: 'aiPausedAt',
  aiCycleResetAt: 'aiCycleResetAt',
  firstResponseAt: 'firstResponseAt',
  closedAt: 'closedAt',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConversationNoteScalarFieldEnum = {
  id: 'id',
  body: 'body',
  authorId: 'authorId',
  authorName: 'authorName',
  type: 'type',
  createdAt: 'createdAt',
  conversationId: 'conversationId'
};

exports.Prisma.ActivityScalarFieldEnum = {
  id: 'id',
  type: 'type',
  body: 'body',
  meta: 'meta',
  authorId: 'authorId',
  authorName: 'authorName',
  createdAt: 'createdAt',
  conversationId: 'conversationId',
  leadId: 'leadId',
  ticketId: 'ticketId',
  companyId: 'companyId'
};

exports.Prisma.TicketScalarFieldEnum = {
  id: 'id',
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  category: 'category',
  phone: 'phone',
  clickupTaskId: 'clickupTaskId',
  ticketStage: 'ticketStage',
  isInternal: 'isInternal',
  type: 'type',
  dueDate: 'dueDate',
  clientCompanyId: 'clientCompanyId',
  assigneeId: 'assigneeId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  companyId: 'companyId',
  createdById: 'createdById',
  setorId: 'setorId',
  projetoId: 'projetoId',
  visibility: 'visibility'
};

exports.Prisma.TicketMessageScalarFieldEnum = {
  id: 'id',
  body: 'body',
  isInternal: 'isInternal',
  authorName: 'authorName',
  authorRole: 'authorRole',
  mediaBase64: 'mediaBase64',
  mediaType: 'mediaType',
  source: 'source',
  externalId: 'externalId',
  createdAt: 'createdAt',
  ticketId: 'ticketId'
};

exports.Prisma.SetorScalarFieldEnum = {
  id: 'id',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  companyId: 'companyId',
  canManageUsers: 'canManageUsers',
  canViewLeads: 'canViewLeads',
  canCreateLeads: 'canCreateLeads',
  canViewTickets: 'canViewTickets',
  canCreateTickets: 'canCreateTickets',
  canViewConfig: 'canViewConfig',
  canUseAI: 'canUseAI',
  canViewInbox: 'canViewInbox',
  canSendMessages: 'canSendMessages',
  canViewCompanies: 'canViewCompanies',
  canCreateCompanies: 'canCreateCompanies',
  canViewCalendario: 'canViewCalendario',
  canViewMarketing: 'canViewMarketing',
  canViewCampanhas: 'canViewCampanhas',
  canViewProjetos: 'canViewProjetos',
  canViewRanking: 'canViewRanking',
  canViewLinks: 'canViewLinks',
  canViewCofre: 'canViewCofre',
  canViewEmail: 'canViewEmail',
  canViewFinanceiro: 'canViewFinanceiro'
};

exports.Prisma.SetorEmailAccountScalarFieldEnum = {
  id: 'id',
  setorId: 'setorId',
  accountId: 'accountId',
  createdAt: 'createdAt'
};

exports.Prisma.SetorClickupListScalarFieldEnum = {
  id: 'id',
  setorId: 'setorId',
  clickupListId: 'clickupListId',
  name: 'name',
  description: 'description',
  type: 'type',
  clientCompanyId: 'clientCompanyId',
  serviceId: 'serviceId',
  status: 'status',
  startDate: 'startDate',
  dueDate: 'dueDate',
  deliveredAt: 'deliveredAt',
  visibility: 'visibility',
  publicToken: 'publicToken',
  taskCount: 'taskCount',
  taskCompleted: 'taskCompleted',
  taskOverdue: 'taskOverdue',
  taskNoDueDate: 'taskNoDueDate',
  taskNoAssignee: 'taskNoAssignee',
  lastSyncedAt: 'lastSyncedAt',
  clientExpectedAt: 'clientExpectedAt',
  clientLastContactAt: 'clientLastContactAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProjectTaskScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  title: 'title',
  description: 'description',
  stage: 'stage',
  projectServiceId: 'projectServiceId',
  checklist: 'checklist',
  comments: 'comments',
  clickupTaskId: 'clickupTaskId',
  awaitingClient: 'awaitingClient',
  visibleToClient: 'visibleToClient',
  done: 'done',
  priority: 'priority',
  startDate: 'startDate',
  dueDate: 'dueDate',
  assigneeId: 'assigneeId',
  createdById: 'createdById',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProjectServiceScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  serviceId: 'serviceId',
  name: 'name',
  order: 'order',
  visibleToClient: 'visibleToClient',
  createdAt: 'createdAt'
};

exports.Prisma.TicketAccessUserScalarFieldEnum = {
  ticketId: 'ticketId',
  userId: 'userId'
};

exports.Prisma.ProjectAccessUserScalarFieldEnum = {
  projectId: 'projectId',
  userId: 'userId'
};

exports.Prisma.ProjectTaskStateScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  taskId: 'taskId',
  name: 'name',
  statusName: 'statusName',
  isCompleted: 'isCompleted',
  hasNoAssignee: 'hasNoAssignee',
  dueDate: 'dueDate',
  startDate: 'startDate',
  dateUpdated: 'dateUpdated',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProjectActivityScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  type: 'type',
  taskName: 'taskName',
  taskId: 'taskId',
  description: 'description',
  authorId: 'authorId',
  authorName: 'authorName',
  createdAt: 'createdAt'
};

exports.Prisma.ProjectMemberScalarFieldEnum = {
  projectId: 'projectId',
  userId: 'userId',
  role: 'role',
  createdAt: 'createdAt'
};

exports.Prisma.ProjectMaterialScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  taskId: 'taskId',
  kind: 'kind',
  stage: 'stage',
  title: 'title',
  docHtml: 'docHtml',
  url: 'url',
  ata: 'ata',
  mediaBase64: 'mediaBase64',
  mediaType: 'mediaType',
  featured: 'featured',
  visibleToClient: 'visibleToClient',
  order: 'order',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SetorUserScalarFieldEnum = {
  setorId: 'setorId',
  userId: 'userId'
};

exports.Prisma.SetorInstanceScalarFieldEnum = {
  setorId: 'setorId',
  instanceId: 'instanceId'
};

exports.Prisma.CompanyAssetScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  type: 'type',
  name: 'name',
  url: 'url',
  host: 'host',
  identifier: 'identifier',
  provider: 'provider',
  status: 'status',
  expiresAt: 'expiresAt',
  notes: 'notes',
  tags: 'tags',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.CompanyCredentialScalarFieldEnum = {
  id: 'id',
  assetId: 'assetId',
  label: 'label',
  username: 'username',
  passwordEncrypted: 'passwordEncrypted',
  url: 'url',
  totpSecret: 'totpSecret',
  notes: 'notes',
  lastRotatedAt: 'lastRotatedAt',
  sharedWithClient: 'sharedWithClient',
  sharedAt: 'sharedAt',
  archivedAt: 'archivedAt',
  archivedById: 'archivedById',
  archivedByName: 'archivedByName',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.CredentialAccessLogScalarFieldEnum = {
  id: 'id',
  credentialId: 'credentialId',
  companyId: 'companyId',
  userId: 'userId',
  userName: 'userName',
  userRole: 'userRole',
  action: 'action',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt'
};

exports.Prisma.CompanySecureNoteScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  title: 'title',
  contentEncrypted: 'contentEncrypted',
  archivedAt: 'archivedAt',
  archivedById: 'archivedById',
  archivedByName: 'archivedByName',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.SecureNoteAccessLogScalarFieldEnum = {
  id: 'id',
  noteId: 'noteId',
  companyId: 'companyId',
  userId: 'userId',
  userName: 'userName',
  userRole: 'userRole',
  action: 'action',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt'
};

exports.Prisma.MarketingIntegrationScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  provider: 'provider',
  accountId: 'accountId',
  accountLabel: 'accountLabel',
  accessTokenEnc: 'accessTokenEnc',
  refreshTokenEnc: 'refreshTokenEnc',
  tokenExpiresAt: 'tokenExpiresAt',
  scopes: 'scopes',
  googleEmail: 'googleEmail',
  googleName: 'googleName',
  status: 'status',
  lastSyncAt: 'lastSyncAt',
  lastSyncStatus: 'lastSyncStatus',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.BlingIntegrationScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  accessTokenEnc: 'accessTokenEnc',
  refreshTokenEnc: 'refreshTokenEnc',
  tokenExpiresAt: 'tokenExpiresAt',
  status: 'status',
  lastSyncAt: 'lastSyncAt',
  lastSyncStatus: 'lastSyncStatus',
  lastError: 'lastError',
  lastClientsSynced: 'lastClientsSynced',
  lastInvoicesSynced: 'lastInvoicesSynced',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.MetaConversionConfigScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  pixelId: 'pixelId',
  accessTokenEnc: 'accessTokenEnc',
  testEventCode: 'testEventCode',
  eventName: 'eventName',
  currency: 'currency',
  enabled: 'enabled',
  lastEventAt: 'lastEventAt',
  lastStatus: 'lastStatus',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MetaConversionLogScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  leadId: 'leadId',
  eventName: 'eventName',
  eventId: 'eventId',
  status: 'status',
  attempts: 'attempts',
  value: 'value',
  currency: 'currency',
  matchQuality: 'matchQuality',
  eventsReceived: 'eventsReceived',
  fbtraceId: 'fbtraceId',
  lastError: 'lastError',
  nextRetryAt: 'nextRetryAt',
  sentAt: 'sentAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InstagramAccountScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  igUserId: 'igUserId',
  igScopedId: 'igScopedId',
  username: 'username',
  name: 'name',
  profilePictureUrl: 'profilePictureUrl',
  accessTokenEnc: 'accessTokenEnc',
  tokenExpiresAt: 'tokenExpiresAt',
  scopes: 'scopes',
  status: 'status',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.IgAutomationScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  accountId: 'accountId',
  name: 'name',
  enabled: 'enabled',
  mediaId: 'mediaId',
  mediaLabel: 'mediaLabel',
  triggerType: 'triggerType',
  keywords: 'keywords',
  replyToComment: 'replyToComment',
  commentReplies: 'commentReplies',
  sendDm: 'sendDm',
  dmText: 'dmText',
  dmLinkUrl: 'dmLinkUrl',
  dmButtonLabel: 'dmButtonLabel',
  deliveredText: 'deliveredText',
  requireFollow: 'requireFollow',
  notFollowingText: 'notFollowingText',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.IgAutomationRunScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  accountId: 'accountId',
  automationId: 'automationId',
  igCommenterId: 'igCommenterId',
  username: 'username',
  mediaId: 'mediaId',
  commentId: 'commentId',
  commentText: 'commentText',
  status: 'status',
  followState: 'followState',
  errorDetail: 'errorDetail',
  leadId: 'leadId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.IgConversationScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  channel: 'channel',
  connectionId: 'connectionId',
  accountId: 'accountId',
  participantId: 'participantId',
  participantUsername: 'participantUsername',
  lastMessageAt: 'lastMessageAt',
  lastMessageText: 'lastMessageText',
  lastDirection: 'lastDirection',
  needsReply: 'needsReply',
  hadAutomation: 'hadAutomation',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.IgMessageScalarFieldEnum = {
  id: 'id',
  conversationId: 'conversationId',
  companyId: 'companyId',
  direction: 'direction',
  source: 'source',
  text: 'text',
  mid: 'mid',
  createdAt: 'createdAt'
};

exports.Prisma.FacebookPageScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  pageId: 'pageId',
  name: 'name',
  pageAccessTokenEnc: 'pageAccessTokenEnc',
  scopes: 'scopes',
  status: 'status',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.AnalyticsSnapshotScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  source: 'source',
  sessions: 'sessions',
  users: 'users',
  newUsers: 'newUsers',
  pageviews: 'pageviews',
  conversions: 'conversions',
  bounceRate: 'bounceRate',
  avgSessionSec: 'avgSessionSec',
  engagedSessions: 'engagedSessions',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AnalyticsTopPageScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  source: 'source',
  pagePath: 'pagePath',
  pageTitle: 'pageTitle',
  views: 'views',
  users: 'users',
  avgTimeSec: 'avgTimeSec'
};

exports.Prisma.AnalyticsTrafficSourceScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  source: 'source',
  rawSource: 'rawSource',
  rawMedium: 'rawMedium',
  bucket: 'bucket',
  sessions: 'sessions',
  users: 'users',
  conversions: 'conversions'
};

exports.Prisma.AnalyticsGeoDataScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  source: 'source',
  countryCode: 'countryCode',
  countryName: 'countryName',
  region: 'region',
  city: 'city',
  sessions: 'sessions',
  users: 'users'
};

exports.Prisma.AnalyticsEventDailyScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  source: 'source',
  eventName: 'eventName',
  eventCount: 'eventCount',
  users: 'users',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AnalyticsEventParamDailyScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  source: 'source',
  eventName: 'eventName',
  paramName: 'paramName',
  paramValue: 'paramValue',
  eventCount: 'eventCount',
  users: 'users',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MarketingEventConfigScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  source: 'source',
  eventName: 'eventName',
  isConversion: 'isConversion',
  featured: 'featured',
  displayLabel: 'displayLabel',
  hidden: 'hidden',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SearchConsoleQueryScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  query: 'query',
  page: 'page',
  country: 'country',
  device: 'device',
  clicks: 'clicks',
  impressions: 'impressions',
  ctr: 'ctr',
  position: 'position'
};

exports.Prisma.GbpInsightScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  date: 'date',
  impressionsSearchDesktop: 'impressionsSearchDesktop',
  impressionsSearchMobile: 'impressionsSearchMobile',
  impressionsMapsDesktop: 'impressionsMapsDesktop',
  impressionsMapsMobile: 'impressionsMapsMobile',
  callClicks: 'callClicks',
  websiteClicks: 'websiteClicks',
  directionRequests: 'directionRequests',
  conversations: 'conversations',
  bookings: 'bookings',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GbpReviewScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  googleReviewId: 'googleReviewId',
  reviewerName: 'reviewerName',
  reviewerPhotoUrl: 'reviewerPhotoUrl',
  starRating: 'starRating',
  comment: 'comment',
  createTime: 'createTime',
  updateTime: 'updateTime',
  replyComment: 'replyComment',
  replyUpdateTime: 'replyUpdateTime',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GbpSearchKeywordScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  keyword: 'keyword',
  year: 'year',
  month: 'month',
  impressions: 'impressions',
  isThreshold: 'isThreshold',
  createdAt: 'createdAt'
};

exports.Prisma.GbpProfileSnapshotScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  title: 'title',
  primaryCategory: 'primaryCategory',
  storefrontAddress: 'storefrontAddress',
  primaryPhone: 'primaryPhone',
  websiteUri: 'websiteUri',
  regularHours: 'regularHours',
  description: 'description',
  photoCount: 'photoCount',
  completenessScore: 'completenessScore',
  googleAverageRating: 'googleAverageRating',
  googleReviewCount: 'googleReviewCount',
  syncedAt: 'syncedAt'
};

exports.Prisma.AdCampaignDailyScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  provider: 'provider',
  date: 'date',
  externalCampaignId: 'externalCampaignId',
  campaignName: 'campaignName',
  campaignStatus: 'campaignStatus',
  impressions: 'impressions',
  clicks: 'clicks',
  cost: 'cost',
  conversions: 'conversions',
  conversionValue: 'conversionValue',
  currency: 'currency',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AdSearchTermDailyScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  provider: 'provider',
  date: 'date',
  searchTerm: 'searchTerm',
  adGroupId: 'adGroupId',
  adGroupName: 'adGroupName',
  campaignName: 'campaignName',
  impressions: 'impressions',
  clicks: 'clicks',
  cost: 'cost',
  conversions: 'conversions',
  conversionValue: 'conversionValue',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AdCreativeScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  provider: 'provider',
  externalAdId: 'externalAdId',
  externalCampaignId: 'externalCampaignId',
  externalAdSetId: 'externalAdSetId',
  campaignName: 'campaignName',
  adGroupName: 'adGroupName',
  adType: 'adType',
  status: 'status',
  headlines: 'headlines',
  descriptions: 'descriptions',
  finalUrl: 'finalUrl',
  path1: 'path1',
  path2: 'path2',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AdCreativeDailyScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  provider: 'provider',
  date: 'date',
  externalAdId: 'externalAdId',
  impressions: 'impressions',
  clicks: 'clicks',
  cost: 'cost',
  conversions: 'conversions',
  conversionValue: 'conversionValue',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SubscriptionScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  plan: 'plan',
  status: 'status',
  billingCycle: 'billingCycle',
  trialEndsAt: 'trialEndsAt',
  currentPeriodStart: 'currentPeriodStart',
  currentPeriodEnd: 'currentPeriodEnd',
  cancelAtPeriodEnd: 'cancelAtPeriodEnd',
  canceledAt: 'canceledAt',
  stripeCustomerId: 'stripeCustomerId',
  stripeSubscriptionId: 'stripeSubscriptionId',
  stripePriceId: 'stripePriceId',
  cardBrand: 'cardBrand',
  cardLast4: 'cardLast4',
  customLimits: 'customLimits',
  customFeatures: 'customFeatures',
  customNotes: 'customNotes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BusinessHoursConfigScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  dayOfWeek: 'dayOfWeek',
  isOpen: 'isOpen',
  openTime: 'openTime',
  closeTime: 'closeTime',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BusinessHoursIntervalScalarFieldEnum = {
  id: 'id',
  configId: 'configId',
  startTime: 'startTime',
  endTime: 'endTime',
  label: 'label'
};

exports.Prisma.RewardScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  name: 'name',
  description: 'description',
  cost: 'cost',
  available: 'available',
  imageUrl: 'imageUrl',
  stock: 'stock',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RewardRedemptionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  companyId: 'companyId',
  rewardId: 'rewardId',
  rewardName: 'rewardName',
  cost: 'cost',
  status: 'status',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  resolvedAt: 'resolvedAt'
};

exports.Prisma.UserScoreScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  companyId: 'companyId',
  totalPoints: 'totalPoints',
  monthPoints: 'monthPoints',
  redeemablePoints: 'redeemablePoints',
  month: 'month',
  year: 'year',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserBadgeScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  companyId: 'companyId',
  badge: 'badge',
  tier: 'tier',
  earnedAt: 'earnedAt'
};

exports.Prisma.ScoreEventScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  companyId: 'companyId',
  points: 'points',
  reason: 'reason',
  referenceId: 'referenceId',
  description: 'description',
  authorId: 'authorId',
  authorName: 'authorName',
  createdAt: 'createdAt'
};

exports.Prisma.ScoreRuleConfigScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  reason: 'reason',
  enabled: 'enabled',
  points: 'points',
  affectsRanking: 'affectsRanking',
  updatedAt: 'updatedAt'
};

exports.Prisma.PushSubscriptionScalarFieldEnum = {
  id: 'id',
  endpoint: 'endpoint',
  p256dh: 'p256dh',
  auth: 'auth',
  userAgent: 'userAgent',
  userId: 'userId',
  lastFailedAt: 'lastFailedAt',
  failCount: 'failCount',
  createdAt: 'createdAt'
};

exports.Prisma.UserNotifPreferencesScalarFieldEnum = {
  userId: 'userId',
  newMessage: 'newMessage',
  hotSignal: 'hotSignal',
  taskOverdue: 'taskOverdue',
  followUp: 'followUp',
  updatedAt: 'updatedAt'
};

exports.Prisma.CompanyEmailConfigScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  host: 'host',
  port: 'port',
  secure: 'secure',
  user: 'user',
  passEnc: 'passEnc',
  fromEmail: 'fromEmail',
  fromName: 'fromName',
  replyTo: 'replyTo',
  verified: 'verified',
  lastVerifiedAt: 'lastVerifiedAt',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EmailTemplateScalarFieldEnum = {
  id: 'id',
  name: 'name',
  subject: 'subject',
  html: 'html',
  text: 'text',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EmailCampaignScalarFieldEnum = {
  id: 'id',
  name: 'name',
  subject: 'subject',
  templateId: 'templateId',
  status: 'status',
  scheduledAt: 'scheduledAt',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  cadenceConfig: 'cadenceConfig',
  segmentFilter: 'segmentFilter',
  totalRecipients: 'totalRecipients',
  sentCount: 'sentCount',
  deliveredCount: 'deliveredCount',
  openedCount: 'openedCount',
  clickedCount: 'clickedCount',
  bouncedCount: 'bouncedCount',
  unsubscribedCount: 'unsubscribedCount',
  failedCount: 'failedCount',
  companyId: 'companyId',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EmailRecipientScalarFieldEnum = {
  id: 'id',
  campaignId: 'campaignId',
  leadId: 'leadId',
  email: 'email',
  name: 'name',
  vars: 'vars',
  status: 'status',
  sentAt: 'sentAt',
  firstOpenedAt: 'firstOpenedAt',
  firstClickedAt: 'firstClickedAt',
  bouncedAt: 'bouncedAt',
  errorMessage: 'errorMessage',
  token: 'token',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EmailEventScalarFieldEnum = {
  id: 'id',
  recipientId: 'recipientId',
  type: 'type',
  targetUrl: 'targetUrl',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt'
};

exports.Prisma.EmailUnsubscribeScalarFieldEnum = {
  id: 'id',
  email: 'email',
  reason: 'reason',
  companyId: 'companyId',
  createdAt: 'createdAt'
};

exports.Prisma.EmailAccountScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  label: 'label',
  fromName: 'fromName',
  fromEmail: 'fromEmail',
  smtpHost: 'smtpHost',
  smtpPort: 'smtpPort',
  smtpSecure: 'smtpSecure',
  smtpUser: 'smtpUser',
  smtpPassEnc: 'smtpPassEnc',
  imapHost: 'imapHost',
  imapPort: 'imapPort',
  imapSecure: 'imapSecure',
  imapUser: 'imapUser',
  imapPassEnc: 'imapPassEnc',
  signature: 'signature',
  active: 'active',
  lastUid: 'lastUid',
  uidValidity: 'uidValidity',
  lastSyncedAt: 'lastSyncedAt',
  sentLastUid: 'sentLastUid',
  sentUidValidity: 'sentUidValidity',
  smtpVerified: 'smtpVerified',
  imapVerified: 'imapVerified',
  lastVerifiedAt: 'lastVerifiedAt',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InboxEmailScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  accountId: 'accountId',
  direction: 'direction',
  folder: 'folder',
  messageId: 'messageId',
  imapUid: 'imapUid',
  fromEmail: 'fromEmail',
  fromName: 'fromName',
  toEmail: 'toEmail',
  ccEmail: 'ccEmail',
  bccEmail: 'bccEmail',
  subject: 'subject',
  snippet: 'snippet',
  textBody: 'textBody',
  htmlBody: 'htmlBody',
  inReplyTo: 'inReplyTo',
  leadId: 'leadId',
  ticketId: 'ticketId',
  aiImportance: 'aiImportance',
  aiSummary: 'aiSummary',
  suspicious: 'suspicious',
  seen: 'seen',
  sentAt: 'sentAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InboxSenderRuleScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  fromEmail: 'fromEmail',
  type: 'type',
  createdAt: 'createdAt'
};

exports.Prisma.InboxEmailAttachmentScalarFieldEnum = {
  id: 'id',
  emailId: 'emailId',
  filename: 'filename',
  contentType: 'contentType',
  size: 'size',
  partId: 'partId',
  createdAt: 'createdAt'
};

exports.Prisma.InboxEmailTagScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  name: 'name',
  color: 'color',
  createdAt: 'createdAt'
};

exports.Prisma.BillingEventScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  type: 'type',
  fromPlan: 'fromPlan',
  toPlan: 'toPlan',
  amount: 'amount',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.SubscriptionAddonScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  type: 'type',
  quantity: 'quantity',
  unitPrice: 'unitPrice',
  stripeItemId: 'stripeItemId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CouponScalarFieldEnum = {
  id: 'id',
  code: 'code',
  label: 'label',
  discountType: 'discountType',
  discountValue: 'discountValue',
  recurring: 'recurring',
  validFrom: 'validFrom',
  validUntil: 'validUntil',
  maxUses: 'maxUses',
  usedCount: 'usedCount',
  appliesToPlans: 'appliesToPlans',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  createdById: 'createdById'
};

exports.Prisma.CouponRedemptionScalarFieldEnum = {
  id: 'id',
  couponId: 'couponId',
  companyId: 'companyId',
  appliedAt: 'appliedAt',
  planAtApply: 'planAtApply',
  amountOff: 'amountOff'
};

exports.Prisma.AdminAuditLogScalarFieldEnum = {
  id: 'id',
  adminUserId: 'adminUserId',
  adminUserName: 'adminUserName',
  adminUserEmail: 'adminUserEmail',
  action: 'action',
  targetCompanyId: 'targetCompanyId',
  targetUserId: 'targetUserId',
  ip: 'ip',
  userAgent: 'userAgent',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.AssistantScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  name: 'name',
  type: 'type',
  manual: 'manual',
  isActive: 'isActive',
  autoRespond: 'autoRespond',
  discloseAi: 'discloseAi',
  learnings: 'learnings',
  qualificationChecklist: 'qualificationChecklist',
  schedulingLink: 'schedulingLink',
  calendarUserId: 'calendarUserId',
  meetingDurationMin: 'meetingDurationMin',
  courtesyDelayMin: 'courtesyDelayMin',
  courtesyText: 'courtesyText',
  groupFirstAidDelayMin: 'groupFirstAidDelayMin',
  reactivationWord: 'reactivationWord',
  sendPauseNotice: 'sendPauseNotice',
  pauseNoticeText: 'pauseNoticeText',
  instanceId: 'instanceId',
  model: 'model',
  temperature: 'temperature',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ScheduledMessageScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  instanceId: 'instanceId',
  phone: 'phone',
  body: 'body',
  sendAt: 'sendAt',
  status: 'status',
  kind: 'kind',
  meta: 'meta',
  sentAt: 'sentAt',
  lastError: 'lastError',
  createdAt: 'createdAt'
};

exports.Prisma.AssistantRouteScalarFieldEnum = {
  id: 'id',
  assistantId: 'assistantId',
  intent: 'intent',
  label: 'label',
  setorId: 'setorId',
  createLead: 'createLead',
  createTicket: 'createTicket',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AiUsageLogScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  assistantId: 'assistantId',
  endpoint: 'endpoint',
  model: 'model',
  tokensPrompt: 'tokensPrompt',
  tokensCompletion: 'tokensCompletion',
  tokensTotal: 'tokensTotal',
  userId: 'userId',
  createdAt: 'createdAt'
};

exports.Prisma.ServiceScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  name: 'name',
  description: 'description',
  qualifyingQuestions: 'qualifyingQuestions',
  salesArguments: 'salesArguments',
  references: 'references',
  priceRange: 'priceRange',
  isActive: 'isActive',
  showInClientArea: 'showInClientArea',
  order: 'order',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ClientServiceScalarFieldEnum = {
  id: 'id',
  clientCompanyId: 'clientCompanyId',
  serviceId: 'serviceId',
  label: 'label',
  status: 'status',
  renewsAt: 'renewsAt',
  startedAt: 'startedAt',
  endedAt: 'endedAt',
  url: 'url',
  notes: 'notes',
  details: 'details',
  order: 'order',
  amountCents: 'amountCents',
  isRecurring: 'isRecurring',
  billingCycle: 'billingCycle',
  billingDay: 'billingDay',
  bonusEligible: 'bonusEligible',
  externalId: 'externalId',
  provider: 'provider',
  externalClientName: 'externalClientName',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BillingSkipScalarFieldEnum = {
  id: 'id',
  clientServiceId: 'clientServiceId',
  month: 'month',
  reason: 'reason',
  userName: 'userName',
  createdAt: 'createdAt'
};

exports.Prisma.FinanceLogScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  clientCompanyId: 'clientCompanyId',
  entity: 'entity',
  entityId: 'entityId',
  action: 'action',
  description: 'description',
  meta: 'meta',
  userName: 'userName',
  createdAt: 'createdAt'
};

exports.Prisma.ClientInvoiceScalarFieldEnum = {
  id: 'id',
  clientCompanyId: 'clientCompanyId',
  clientServiceId: 'clientServiceId',
  description: 'description',
  referenceMonth: 'referenceMonth',
  amountCents: 'amountCents',
  dueDate: 'dueDate',
  status: 'status',
  paidAt: 'paidAt',
  boletoUrl: 'boletoUrl',
  invoiceUrl: 'invoiceUrl',
  notes: 'notes',
  externalId: 'externalId',
  provider: 'provider',
  saleId: 'saleId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SaleScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  leadId: 'leadId',
  clientCompanyId: 'clientCompanyId',
  title: 'title',
  valueCents: 'valueCents',
  kind: 'kind',
  closedAt: 'closedAt',
  sellerId: 'sellerId',
  sellerName: 'sellerName',
  responsibleId: 'responsibleId',
  responsibleName: 'responsibleName',
  clickupTaskId: 'clickupTaskId',
  contractStatus: 'contractStatus',
  contractAt: 'contractAt',
  billingStatus: 'billingStatus',
  billedAt: 'billedAt',
  productionStatus: 'productionStatus',
  bonusEligible: 'bonusEligible',
  releasedAt: 'releasedAt',
  deliveredAt: 'deliveredAt',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BonusScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  month: 'month',
  saleId: 'saleId',
  clientServiceId: 'clientServiceId',
  userId: 'userId',
  name: 'name',
  serviceValueCents: 'serviceValueCents',
  amountCents: 'amountCents',
  paidAt: 'paidAt',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MonthlyTargetScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  month: 'month',
  revenueTargetCents: 'revenueTargetCents',
  newSalesTargetCents: 'newSalesTargetCents',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VideoCategoryScalarFieldEnum = {
  id: 'id',
  title: 'title',
  description: 'description',
  emoji: 'emoji',
  accent: 'accent',
  position: 'position',
  active: 'active',
  scope: 'scope',
  visibility: 'visibility',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VideoCategoryReleaseScalarFieldEnum = {
  id: 'id',
  categoryId: 'categoryId',
  companyId: 'companyId',
  createdAt: 'createdAt'
};

exports.Prisma.VideoScalarFieldEnum = {
  id: 'id',
  categoryId: 'categoryId',
  title: 'title',
  description: 'description',
  youtubeId: 'youtubeId',
  thumbnailUrl: 'thumbnailUrl',
  durationLabel: 'durationLabel',
  position: 'position',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TimePunchScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  userId: 'userId',
  type: 'type',
  timestamp: 'timestamp',
  source: 'source',
  ip: 'ip',
  adjustRequestId: 'adjustRequestId',
  createdAt: 'createdAt'
};

exports.Prisma.WorkScheduleDayScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  userId: 'userId',
  dayOfWeek: 'dayOfWeek',
  active: 'active',
  startTime: 'startTime',
  endTime: 'endTime',
  breakStart: 'breakStart',
  breakEnd: 'breakEnd'
};

exports.Prisma.TimeOffEntryScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  userId: 'userId',
  type: 'type',
  startDate: 'startDate',
  endDate: 'endDate',
  description: 'description',
  createdById: 'createdById',
  createdAt: 'createdAt'
};

exports.Prisma.PunchAdjustRequestScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  userId: 'userId',
  date: 'date',
  punches: 'punches',
  reason: 'reason',
  status: 'status',
  reviewedById: 'reviewedById',
  reviewedAt: 'reviewedAt',
  reviewNote: 'reviewNote',
  createdAt: 'createdAt'
};

exports.Prisma.TimesheetSignatureScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  userId: 'userId',
  year: 'year',
  month: 'month',
  signedAt: 'signedAt',
  ip: 'ip'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.UserRole = exports.$Enums.UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  CLIENT: 'CLIENT'
};

exports.RankingCategory = exports.$Enums.RankingCategory = {
  PRODUCAO: 'PRODUCAO',
  GESTAO: 'GESTAO'
};

exports.CompanyStatus = exports.$Enums.CompanyStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.ModoAtendimento = exports.$Enums.ModoAtendimento = {
  VISAO: 'VISAO',
  ATENDE: 'ATENDE'
};

exports.CampaignSource = exports.$Enums.CampaignSource = {
  WHATSAPP: 'WHATSAPP',
  INSTAGRAM: 'INSTAGRAM',
  FACEBOOK: 'FACEBOOK',
  GOOGLE: 'GOOGLE',
  LINK: 'LINK',
  OTHER: 'OTHER'
};

exports.CampaignStatus = exports.$Enums.CampaignStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  FINISHED: 'FINISHED'
};

exports.ClickEventKind = exports.$Enums.ClickEventKind = {
  OPEN: 'OPEN',
  INTERNAL: 'INTERNAL'
};

exports.LeadStatus = exports.$Enums.LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  PROPOSAL: 'PROPOSAL',
  CLOSED: 'CLOSED',
  LOST: 'LOST'
};

exports.CustomFieldType = exports.$Enums.CustomFieldType = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  SELECT: 'SELECT',
  LINK: 'LINK'
};

exports.TaskSource = exports.$Enums.TaskSource = {
  MANUAL: 'MANUAL',
  AUTO_LINK_OPEN: 'AUTO_LINK_OPEN'
};

exports.StageOutcome = exports.$Enums.StageOutcome = {
  NEUTRO: 'NEUTRO',
  GANHO: 'GANHO',
  PERDIDO: 'PERDIDO'
};

exports.InstanceStatus = exports.$Enums.InstanceStatus = {
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING'
};

exports.MessageDir = exports.$Enums.MessageDir = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND'
};

exports.KeywordMatchMode = exports.$Enums.KeywordMatchMode = {
  CONTAINS: 'CONTAINS',
  EXACT: 'EXACT'
};

exports.ConversationStatus = exports.$Enums.ConversationStatus = {
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_CUSTOMER: 'WAITING_CUSTOMER',
  SCHEDULED: 'SCHEDULED',
  CLOSED: 'CLOSED'
};

exports.AiMode = exports.$Enums.AiMode = {
  ACTIVE: 'ACTIVE',
  PAUSED_HUMAN: 'PAUSED_HUMAN',
  OFF: 'OFF'
};

exports.ActivityType = exports.$Enums.ActivityType = {
  STATUS_CHANGED: 'STATUS_CHANGED',
  ASSIGNEE_CHANGED: 'ASSIGNEE_CHANGED',
  SECTOR_CHANGED: 'SECTOR_CHANGED',
  STAGE_CHANGED: 'STAGE_CHANGED',
  PIPELINE_CHANGED: 'PIPELINE_CHANGED',
  VALUE_CHANGED: 'VALUE_CHANGED',
  NOTE_ADDED: 'NOTE_ADDED',
  CLICKUP_LINKED: 'CLICKUP_LINKED',
  TRACKING_LINK_SET: 'TRACKING_LINK_SET',
  LEAD_LINKED: 'LEAD_LINKED',
  CONVERSATION_REOPENED: 'CONVERSATION_REOPENED',
  CONVERSATION_CLOSED: 'CONVERSATION_CLOSED',
  TRANSFERRED: 'TRANSFERRED'
};

exports.TicketStatus = exports.$Enums.TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED'
};

exports.TicketPriority = exports.$Enums.TicketPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT'
};

exports.ProjectStatus = exports.$Enums.ProjectStatus = {
  PLANEJAMENTO: 'PLANEJAMENTO',
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  AGUARDANDO_CLIENTE: 'AGUARDANDO_CLIENTE',
  PAUSADO: 'PAUSADO',
  ENTREGUE: 'ENTREGUE',
  CANCELADO: 'CANCELADO'
};

exports.AssetType = exports.$Enums.AssetType = {
  DOMAIN: 'DOMAIN',
  HOSTING: 'HOSTING',
  WEBSITE: 'WEBSITE',
  EMAIL_ACCOUNT: 'EMAIL_ACCOUNT',
  DATABASE: 'DATABASE',
  DNS_PROVIDER: 'DNS_PROVIDER',
  REPOSITORY: 'REPOSITORY',
  SOCIAL_ACCOUNT: 'SOCIAL_ACCOUNT',
  ANALYTICS: 'ANALYTICS',
  CLOUD_SERVICE: 'CLOUD_SERVICE',
  OTHER: 'OTHER'
};

exports.AssetStatus = exports.$Enums.AssetStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  ARCHIVED: 'ARCHIVED'
};

exports.CredentialAction = exports.$Enums.CredentialAction = {
  REVEAL: 'REVEAL',
  COPY: 'COPY',
  SHARE: 'SHARE',
  EDIT: 'EDIT',
  CREATE: 'CREATE',
  DELETE: 'DELETE',
  ARCHIVE: 'ARCHIVE',
  RESTORE: 'RESTORE'
};

exports.IntegrationProvider = exports.$Enums.IntegrationProvider = {
  GA4: 'GA4',
  SEARCH_CONSOLE: 'SEARCH_CONSOLE',
  BUSINESS_PROFILE: 'BUSINESS_PROFILE',
  GOOGLE_ADS: 'GOOGLE_ADS',
  META_ADS: 'META_ADS'
};

exports.IntegrationStatus = exports.$Enums.IntegrationStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED'
};

exports.MetaConversionStatus = exports.$Enums.MetaConversionStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED'
};

exports.IgTriggerType = exports.$Enums.IgTriggerType = {
  KEYWORD: 'KEYWORD',
  ANY: 'ANY'
};

exports.IgRunStatus = exports.$Enums.IgRunStatus = {
  PENDING: 'PENDING',
  COMMENT_REPLIED: 'COMMENT_REPLIED',
  DM_SENT: 'DM_SENT',
  AWAITING_FOLLOW: 'AWAITING_FOLLOW',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

exports.IgFollowState = exports.$Enums.IgFollowState = {
  UNKNOWN: 'UNKNOWN',
  NOT_FOLLOWING: 'NOT_FOLLOWING',
  FOLLOWING: 'FOLLOWING'
};

exports.InboxChannel = exports.$Enums.InboxChannel = {
  INSTAGRAM: 'INSTAGRAM',
  MESSENGER: 'MESSENGER',
  FACEBOOK: 'FACEBOOK'
};

exports.IgMsgDirection = exports.$Enums.IgMsgDirection = {
  IN: 'IN',
  OUT: 'OUT'
};

exports.IgMsgSource = exports.$Enums.IgMsgSource = {
  ORGANIC: 'ORGANIC',
  AUTOMATION: 'AUTOMATION',
  AGENT: 'AGENT',
  EXTERNAL: 'EXTERNAL'
};

exports.PlanTier = exports.$Enums.PlanTier = {
  FREE: 'FREE',
  TRIAL: 'TRIAL',
  ORGANIZATION: 'ORGANIZATION',
  ESSENCIAL: 'ESSENCIAL',
  MARKETING: 'MARKETING',
  CRESCIMENTO: 'CRESCIMENTO',
  PREMIUM: 'PREMIUM',
  ENTERPRISE: 'ENTERPRISE'
};

exports.SubscriptionStatus = exports.$Enums.SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
  UNPAID: 'UNPAID',
  INCOMPLETE: 'INCOMPLETE'
};

exports.RedemptionStatus = exports.$Enums.RedemptionStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DELIVERED: 'DELIVERED',
  REJECTED: 'REJECTED'
};

exports.BadgeType = exports.$Enums.BadgeType = {
  RAIO_VELOZ: 'RAIO_VELOZ',
  SPRINT_MASTER: 'SPRINT_MASTER',
  PRIMEIRO_DO_DIA: 'PRIMEIRO_DO_DIA',
  RESOLVEDOR: 'RESOLVEDOR',
  ZERO_PENDENCIA: 'ZERO_PENDENCIA',
  ANTECIPADOR: 'ANTECIPADOR',
  CLOSER: 'CLOSER',
  FUNIL_COMPLETO: 'FUNIL_COMPLETO',
  REI_DO_MES: 'REI_DO_MES',
  PONTUAL: 'PONTUAL',
  ENTREGADOR: 'ENTREGADOR',
  CONSTRUTOR: 'CONSTRUTOR',
  ENGAJADO: 'ENGAJADO',
  GERADOR: 'GERADOR',
  CORUJA: 'CORUJA',
  MADRUGADOR: 'MADRUGADOR',
  SORTUDO: 'SORTUDO',
  FENIX: 'FENIX',
  EXERCITO: 'EXERCITO',
  LIDER: 'LIDER',
  GUARDIAO: 'GUARDIAO',
  ALQUIMISTA: 'ALQUIMISTA',
  SNIPER: 'SNIPER',
  TROVAO: 'TROVAO',
  DIPLOMATA: 'DIPLOMATA',
  PRECISO: 'PRECISO',
  NETWORK: 'NETWORK'
};

exports.ScoreReason = exports.$Enums.ScoreReason = {
  RESPOSTA_RAPIDA_5MIN: 'RESPOSTA_RAPIDA_5MIN',
  RESPOSTA_RAPIDA_30MIN: 'RESPOSTA_RAPIDA_30MIN',
  TICKET_RESOLVIDO: 'TICKET_RESOLVIDO',
  LEAD_AVANCADO: 'LEAD_AVANCADO',
  LEAD_CONVERTIDO: 'LEAD_CONVERTIDO',
  DIA_SEM_PENDENCIA: 'DIA_SEM_PENDENCIA',
  DIA_SEM_ATRASO: 'DIA_SEM_ATRASO',
  RETORNO_ANTECIPADO: 'RETORNO_ANTECIPADO',
  ATENDIMENTO_MESMO_DIA: 'ATENDIMENTO_MESMO_DIA',
  NOTA_REGISTRADA: 'NOTA_REGISTRADA',
  PRIMEIRO_CONTATO: 'PRIMEIRO_CONTATO',
  PROJETO_ENTREGUE: 'PROJETO_ENTREGUE',
  PROJETO_ENTREGUE_NO_PRAZO: 'PROJETO_ENTREGUE_NO_PRAZO',
  SLA_VENCIDO: 'SLA_VENCIDO',
  CONVERSA_SEM_RESPOSTA: 'CONVERSA_SEM_RESPOSTA',
  PRAZO_PRORROGADO: 'PRAZO_PRORROGADO',
  PROJETO_ATRASADO: 'PROJETO_ATRASADO',
  TAREFA_SEM_PRAZO: 'TAREFA_SEM_PRAZO',
  TAREFA_CRIADA: 'TAREFA_CRIADA',
  TAREFA_ATUALIZADA: 'TAREFA_ATUALIZADA',
  TAREFA_CONCLUIDA: 'TAREFA_CONCLUIDA',
  TAREFA_ATRASADA: 'TAREFA_ATRASADA',
  TAREFA_SEM_RESPONSAVEL: 'TAREFA_SEM_RESPONSAVEL',
  STREAK_DIA: 'STREAK_DIA',
  BONUS_NOITE: 'BONUS_NOITE',
  BONUS_MADRUGADA: 'BONUS_MADRUGADA',
  BONUS_VENDA_RAPIDA: 'BONUS_VENDA_RAPIDA',
  BONUS_RECUPERACAO: 'BONUS_RECUPERACAO',
  BONUS_SUPEROU_MES: 'BONUS_SUPEROU_MES',
  INCIDENTE: 'INCIDENTE',
  AJUDA_EXERCITO: 'AJUDA_EXERCITO',
  ENCAMINHAMENTO: 'ENCAMINHAMENTO',
  PRIMEIRA_RESPOSTA: 'PRIMEIRA_RESPOSTA',
  TICKET_ATUALIZADO: 'TICKET_ATUALIZADO',
  TICKET_NO_PRAZO: 'TICKET_NO_PRAZO',
  TICKET_RESOLVIDO_MESMO_DIA: 'TICKET_RESOLVIDO_MESMO_DIA',
  ATENDIMENTO_GRUPO_NOVO: 'ATENDIMENTO_GRUPO_NOVO',
  RESPOSTA_RAPIDA_GRUPO: 'RESPOSTA_RAPIDA_GRUPO',
  DIA_NETWORK: 'DIA_NETWORK',
  LEAD_VIROU_OPORTUNIDADE: 'LEAD_VIROU_OPORTUNIDADE',
  TAREFA_LEADHUB_FEITA: 'TAREFA_LEADHUB_FEITA',
  SINAL_QUENTE_RESPONDIDO: 'SINAL_QUENTE_RESPONDIDO',
  PONTO_PONTUAL: 'PONTO_PONTUAL'
};

exports.EmailCampaignStatus = exports.$Enums.EmailCampaignStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  SENDING: 'SENDING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

exports.EmailRecipientStatus = exports.$Enums.EmailRecipientStatus = {
  PENDING: 'PENDING',
  SENDING: 'SENDING',
  SENT: 'SENT',
  BOUNCED: 'BOUNCED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

exports.EmailEventType = exports.$Enums.EmailEventType = {
  OPEN: 'OPEN',
  CLICK: 'CLICK',
  BOUNCE: 'BOUNCE',
  COMPLAINT: 'COMPLAINT',
  UNSUBSCRIBE: 'UNSUBSCRIBE'
};

exports.InboxEmailDirection = exports.$Enums.InboxEmailDirection = {
  IN: 'IN',
  OUT: 'OUT'
};

exports.InboxEmailFolder = exports.$Enums.InboxEmailFolder = {
  INBOX: 'INBOX',
  IMPORTANT: 'IMPORTANT',
  SENT: 'SENT',
  ARCHIVE: 'ARCHIVE',
  SPAM: 'SPAM',
  TRASH: 'TRASH'
};

exports.InboxSenderRuleType = exports.$Enums.InboxSenderRuleType = {
  BLOCK: 'BLOCK',
  ALLOW: 'ALLOW'
};

exports.AddonType = exports.$Enums.AddonType = {
  EXTRA_ATENDENTE: 'EXTRA_ATENDENTE',
  EXTRA_WHATSAPP: 'EXTRA_WHATSAPP'
};

exports.CouponDiscountType = exports.$Enums.CouponDiscountType = {
  PERCENT: 'PERCENT',
  FIXED: 'FIXED'
};

exports.AssistantType = exports.$Enums.AssistantType = {
  PRE_ATENDENTE: 'PRE_ATENDENTE',
  VENDAS: 'VENDAS',
  SUPORTE: 'SUPORTE',
  FINANCEIRO: 'FINANCEIRO',
  GESTOR: 'GESTOR',
  ASSESSOR: 'ASSESSOR'
};

exports.VideoCategoryScope = exports.$Enums.VideoCategoryScope = {
  GLOBAL: 'GLOBAL',
  COMPANY: 'COMPANY'
};

exports.VideoCategoryVisibility = exports.$Enums.VideoCategoryVisibility = {
  ALL: 'ALL',
  SELECTED: 'SELECTED'
};

exports.PunchType = exports.$Enums.PunchType = {
  ENTRADA: 'ENTRADA',
  INTERVALO_INICIO: 'INTERVALO_INICIO',
  INTERVALO_FIM: 'INTERVALO_FIM',
  SAIDA: 'SAIDA'
};

exports.PunchSource = exports.$Enums.PunchSource = {
  MANUAL: 'MANUAL',
  AJUSTE: 'AJUSTE'
};

exports.TimeOffType = exports.$Enums.TimeOffType = {
  ATESTADO: 'ATESTADO',
  FERIAS: 'FERIAS',
  FERIADO: 'FERIADO',
  FOLGA: 'FOLGA'
};

exports.PunchAdjustStatus = exports.$Enums.PunchAdjustStatus = {
  PENDENTE: 'PENDENTE',
  APROVADO: 'APROVADO',
  REJEITADO: 'REJEITADO'
};

exports.Prisma.ModelName = {
  User: 'User',
  QuickReply: 'QuickReply',
  VaultEmailChallenge: 'VaultEmailChallenge',
  VaultTrustedSession: 'VaultTrustedSession',
  UserGoogleConnection: 'UserGoogleConnection',
  Company: 'Company',
  Campaign: 'Campaign',
  TrackingLink: 'TrackingLink',
  ClickEvent: 'ClickEvent',
  Lead: 'Lead',
  Tag: 'Tag',
  LeadTag: 'LeadTag',
  CustomFieldDef: 'CustomFieldDef',
  LeadCustomValue: 'LeadCustomValue',
  CompanyCustomFieldDef: 'CompanyCustomFieldDef',
  CompanyCustomValue: 'CompanyCustomValue',
  Task: 'Task',
  LeadComment: 'LeadComment',
  PipelineStageConfig: 'PipelineStageConfig',
  CompanyContact: 'CompanyContact',
  WhatsappInstance: 'WhatsappInstance',
  Message: 'Message',
  KeywordRule: 'KeywordRule',
  Setting: 'Setting',
  WhatsappQuota: 'WhatsappQuota',
  Conversation: 'Conversation',
  ConversationNote: 'ConversationNote',
  Activity: 'Activity',
  Ticket: 'Ticket',
  TicketMessage: 'TicketMessage',
  Setor: 'Setor',
  SetorEmailAccount: 'SetorEmailAccount',
  SetorClickupList: 'SetorClickupList',
  ProjectTask: 'ProjectTask',
  ProjectService: 'ProjectService',
  TicketAccessUser: 'TicketAccessUser',
  ProjectAccessUser: 'ProjectAccessUser',
  ProjectTaskState: 'ProjectTaskState',
  ProjectActivity: 'ProjectActivity',
  ProjectMember: 'ProjectMember',
  ProjectMaterial: 'ProjectMaterial',
  SetorUser: 'SetorUser',
  SetorInstance: 'SetorInstance',
  CompanyAsset: 'CompanyAsset',
  CompanyCredential: 'CompanyCredential',
  CredentialAccessLog: 'CredentialAccessLog',
  CompanySecureNote: 'CompanySecureNote',
  SecureNoteAccessLog: 'SecureNoteAccessLog',
  MarketingIntegration: 'MarketingIntegration',
  BlingIntegration: 'BlingIntegration',
  MetaConversionConfig: 'MetaConversionConfig',
  MetaConversionLog: 'MetaConversionLog',
  InstagramAccount: 'InstagramAccount',
  IgAutomation: 'IgAutomation',
  IgAutomationRun: 'IgAutomationRun',
  IgConversation: 'IgConversation',
  IgMessage: 'IgMessage',
  FacebookPage: 'FacebookPage',
  AnalyticsSnapshot: 'AnalyticsSnapshot',
  AnalyticsTopPage: 'AnalyticsTopPage',
  AnalyticsTrafficSource: 'AnalyticsTrafficSource',
  AnalyticsGeoData: 'AnalyticsGeoData',
  AnalyticsEventDaily: 'AnalyticsEventDaily',
  AnalyticsEventParamDaily: 'AnalyticsEventParamDaily',
  MarketingEventConfig: 'MarketingEventConfig',
  SearchConsoleQuery: 'SearchConsoleQuery',
  GbpInsight: 'GbpInsight',
  GbpReview: 'GbpReview',
  GbpSearchKeyword: 'GbpSearchKeyword',
  GbpProfileSnapshot: 'GbpProfileSnapshot',
  AdCampaignDaily: 'AdCampaignDaily',
  AdSearchTermDaily: 'AdSearchTermDaily',
  AdCreative: 'AdCreative',
  AdCreativeDaily: 'AdCreativeDaily',
  Subscription: 'Subscription',
  BusinessHoursConfig: 'BusinessHoursConfig',
  BusinessHoursInterval: 'BusinessHoursInterval',
  Reward: 'Reward',
  RewardRedemption: 'RewardRedemption',
  UserScore: 'UserScore',
  UserBadge: 'UserBadge',
  ScoreEvent: 'ScoreEvent',
  ScoreRuleConfig: 'ScoreRuleConfig',
  PushSubscription: 'PushSubscription',
  UserNotifPreferences: 'UserNotifPreferences',
  CompanyEmailConfig: 'CompanyEmailConfig',
  EmailTemplate: 'EmailTemplate',
  EmailCampaign: 'EmailCampaign',
  EmailRecipient: 'EmailRecipient',
  EmailEvent: 'EmailEvent',
  EmailUnsubscribe: 'EmailUnsubscribe',
  EmailAccount: 'EmailAccount',
  InboxEmail: 'InboxEmail',
  InboxSenderRule: 'InboxSenderRule',
  InboxEmailAttachment: 'InboxEmailAttachment',
  InboxEmailTag: 'InboxEmailTag',
  BillingEvent: 'BillingEvent',
  SubscriptionAddon: 'SubscriptionAddon',
  Coupon: 'Coupon',
  CouponRedemption: 'CouponRedemption',
  AdminAuditLog: 'AdminAuditLog',
  Assistant: 'Assistant',
  ScheduledMessage: 'ScheduledMessage',
  AssistantRoute: 'AssistantRoute',
  AiUsageLog: 'AiUsageLog',
  Service: 'Service',
  ClientService: 'ClientService',
  BillingSkip: 'BillingSkip',
  FinanceLog: 'FinanceLog',
  ClientInvoice: 'ClientInvoice',
  Sale: 'Sale',
  Bonus: 'Bonus',
  MonthlyTarget: 'MonthlyTarget',
  VideoCategory: 'VideoCategory',
  VideoCategoryRelease: 'VideoCategoryRelease',
  Video: 'Video',
  TimePunch: 'TimePunch',
  WorkScheduleDay: 'WorkScheduleDay',
  TimeOffEntry: 'TimeOffEntry',
  PunchAdjustRequest: 'PunchAdjustRequest',
  TimesheetSignature: 'TimesheetSignature'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
