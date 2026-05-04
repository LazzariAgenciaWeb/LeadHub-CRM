
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
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  whatsappSignature: 'whatsappSignature',
  companyId: 'companyId',
  rankingCategory: 'rankingCategory',
  lastBadgeSeenAt: 'lastBadgeSeenAt'
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
  slug: 'slug',
  segment: 'segment',
  phone: 'phone',
  email: 'email',
  website: 'website',
  logoUrl: 'logoUrl',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  hasSystemAccess: 'hasSystemAccess',
  moduleWhatsapp: 'moduleWhatsapp',
  moduleCrm: 'moduleCrm',
  moduleTickets: 'moduleTickets',
  moduleAI: 'moduleAI',
  moduleGamificacao: 'moduleGamificacao',
  moduleProjetos: 'moduleProjetos',
  moduleCalendario: 'moduleCalendario',
  parentCompanyId: 'parentCompanyId',
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
  attendanceStatus: 'attendanceStatus',
  expectedReturnAt: 'expectedReturnAt',
  clickupTaskId: 'clickupTaskId',
  isInternal: 'isInternal',
  companyId: 'companyId',
  campaignId: 'campaignId',
  trackingLinkId: 'trackingLinkId',
  conversationId: 'conversationId'
};

exports.Prisma.LeadCommentScalarFieldEnum = {
  id: 'id',
  body: 'body',
  authorName: 'authorName',
  createdAt: 'createdAt',
  leadId: 'leadId'
};

exports.Prisma.PipelineStageConfigScalarFieldEnum = {
  id: 'id',
  pipeline: 'pipeline',
  name: 'name',
  color: 'color',
  order: 'order',
  isFinal: 'isFinal',
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
  phone: 'phone',
  status: 'status',
  webhookUrl: 'webhookUrl',
  instanceToken: 'instanceToken',
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
  conversationId: 'conversationId'
};

exports.Prisma.KeywordRuleScalarFieldEnum = {
  id: 'id',
  keyword: 'keyword',
  mapTo: 'mapTo',
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
  setorId: 'setorId'
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
  canCreateCompanies: 'canCreateCompanies'
};

exports.Prisma.SetorClickupListScalarFieldEnum = {
  id: 'id',
  setorId: 'setorId',
  clickupListId: 'clickupListId',
  name: 'name',
  description: 'description',
  type: 'type',
  clientCompanyId: 'clientCompanyId',
  status: 'status',
  startDate: 'startDate',
  dueDate: 'dueDate',
  deliveredAt: 'deliveredAt',
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

exports.Prisma.ProjectTaskStateScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  taskId: 'taskId',
  name: 'name',
  statusName: 'statusName',
  isCompleted: 'isCompleted',
  hasNoAssignee: 'hasNoAssignee',
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

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
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

exports.LeadStatus = exports.$Enums.LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  PROPOSAL: 'PROPOSAL',
  CLOSED: 'CLOSED',
  LOST: 'LOST'
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

exports.ConversationStatus = exports.$Enums.ConversationStatus = {
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_CUSTOMER: 'WAITING_CUSTOMER',
  SCHEDULED: 'SCHEDULED',
  CLOSED: 'CLOSED'
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
  DELETE: 'DELETE'
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

exports.PlanTier = exports.$Enums.PlanTier = {
  FREE: 'FREE',
  TRIAL: 'TRIAL',
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
  GUARDIAO: 'GUARDIAO'
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
  PRIMEIRA_RESPOSTA: 'PRIMEIRA_RESPOSTA'
};

exports.Prisma.ModelName = {
  User: 'User',
  VaultEmailChallenge: 'VaultEmailChallenge',
  VaultTrustedSession: 'VaultTrustedSession',
  UserGoogleConnection: 'UserGoogleConnection',
  Company: 'Company',
  Campaign: 'Campaign',
  TrackingLink: 'TrackingLink',
  ClickEvent: 'ClickEvent',
  Lead: 'Lead',
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
  SetorClickupList: 'SetorClickupList',
  ProjectTaskState: 'ProjectTaskState',
  ProjectActivity: 'ProjectActivity',
  ProjectMember: 'ProjectMember',
  SetorUser: 'SetorUser',
  SetorInstance: 'SetorInstance',
  CompanyAsset: 'CompanyAsset',
  CompanyCredential: 'CompanyCredential',
  CredentialAccessLog: 'CredentialAccessLog',
  MarketingIntegration: 'MarketingIntegration',
  AnalyticsSnapshot: 'AnalyticsSnapshot',
  AnalyticsTopPage: 'AnalyticsTopPage',
  AnalyticsTrafficSource: 'AnalyticsTrafficSource',
  AnalyticsGeoData: 'AnalyticsGeoData',
  SearchConsoleQuery: 'SearchConsoleQuery',
  Subscription: 'Subscription',
  BusinessHoursConfig: 'BusinessHoursConfig',
  BusinessHoursInterval: 'BusinessHoursInterval',
  Reward: 'Reward',
  RewardRedemption: 'RewardRedemption',
  UserScore: 'UserScore',
  UserBadge: 'UserBadge',
  ScoreEvent: 'ScoreEvent',
  ScoreRuleConfig: 'ScoreRuleConfig',
  BillingEvent: 'BillingEvent',
  AdminAuditLog: 'AdminAuditLog'
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
