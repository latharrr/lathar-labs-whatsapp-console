-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "isFixture" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "optInAt" TIMESTAMP(3),
ADD COLUMN     "optInProof" TEXT,
ADD COLUMN     "optInSource" TEXT,
ADD COLUMN     "optInStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "optOutAt" TIMESTAMP(3),
ADD COLUMN     "optOutSource" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
ADD COLUMN     "lastAwayAt" TIMESTAMP(3),
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastMessagePreview" TEXT,
ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "unread" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "errorTitle" TEXT,
ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaId" TEXT,
ADD COLUMN     "mediaMime" TEXT,
ADD COLUMN     "mediaName" TEXT,
ADD COLUMN     "mediaPath" TEXT,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaStatus" TEXT,
ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "outboundId" TEXT,
ADD COLUMN     "sentById" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "businessHours" JSONB,
ADD COLUMN     "eventRetentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "messageRetentionDays" INTEGER,
ADD COLUMN     "optInKeywords" TEXT[] DEFAULT ARRAY['START']::TEXT[],
ADD COLUMN     "optOutKeywords" TEXT[] DEFAULT ARRAY['STOP', 'UNSUBSCRIBE', 'STOP PROMOTIONS', 'NOT INTERESTED']::TEXT[],
ADD COLUMN     "optOutReply" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "sendsPerSecond" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "components" JSONB,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "metaTemplateId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "field" TEXT,
ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "ContactAttribute" (
    "contactId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ContactAttribute_pkey" PRIMARY KEY ("contactId","key")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "campaignId" TEXT,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "wamid" TEXT,
    "notBefore" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "category" TEXT,
    "language" TEXT,
    "components" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "segmentId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "variants" JSONB NOT NULL,
    "throttlePerMinute" INTEGER NOT NULL DEFAULT 60,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "utm" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "outboundId" TEXT,
    "wamid" TEXT,
    "errorCode" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "url" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "phoneNumberId" TEXT,
    "config" JSONB NOT NULL,
    "flowId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "graph" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "currentNode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "log" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundWebhook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_orgId_key_key" ON "CustomField"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_orgId_name_key" ON "Tag"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_orgId_name_key" ON "Segment"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_orgId_shortcut_key" ON "QuickReply"("orgId", "shortcut");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_idempotencyKey_key" ON "OutboundMessage"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_wamid_key" ON "OutboundMessage"("wamid");

-- CreateIndex
CREATE INDEX "OutboundMessage_orgId_status_idx" ON "OutboundMessage"("orgId", "status");

-- CreateIndex
CREATE INDEX "OutboundMessage_contactId_status_idx" ON "OutboundMessage"("contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "Campaign_orgId_status_idx" ON "Campaign"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_outboundId_key" ON "CampaignRecipient"("outboundId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_wamid_idx" ON "CampaignRecipient"("wamid");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_code_key" ON "TrackedLink"("code");

-- CreateIndex
CREATE INDEX "FlowRun_conversationId_status_idx" ON "FlowRun"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiEvent_orgId_name_createdAt_idx" ON "ApiEvent"("orgId", "name", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Contact_orgId_optInStatus_idx" ON "Contact"("orgId", "optInStatus");

-- CreateIndex
CREATE INDEX "Conversation_orgId_status_lastMessageAt_idx" ON "Conversation"("orgId", "status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_outboundId_key" ON "Message"("outboundId");

-- CreateIndex
CREATE INDEX "Message_conversationId_timestamp_idx" ON "Message"("conversationId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_orgId_timestamp_idx" ON "Message"("orgId", "timestamp");

-- CreateIndex
CREATE INDEX "WebhookEvent_orgId_receivedAt_idx" ON "WebhookEvent"("orgId", "receivedAt");

-- AddForeignKey
ALTER TABLE "ContactAttribute" ADD CONSTRAINT "ContactAttribute_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "PhoneNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "PhoneNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_outboundId_fkey" FOREIGN KEY ("outboundId") REFERENCES "OutboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundWebhook" ADD CONSTRAINT "OutboundWebhook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "OutboundWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiEvent" ADD CONSTRAINT "ApiEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (additive): every conversation and message gets its workspace from number -> WABA -> org.
UPDATE "Conversation" c SET "orgId" = w."orgId"
  FROM "PhoneNumber" p JOIN "Waba" w ON w.id = p."wabaId" WHERE p.id = c."phoneNumberId";
UPDATE "Message" m SET "orgId" = w."orgId"
  FROM "PhoneNumber" p JOIN "Waba" w ON w.id = p."wabaId" WHERE p.id = m."phoneNumberId";
ALTER TABLE "Conversation" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "orgId" SET NOT NULL;

UPDATE "Conversation" c SET "lastMessageAt" = x.t FROM (SELECT "conversationId", max(timestamp) t FROM "Message" GROUP BY 1) x WHERE x."conversationId" = c.id;

-- Contacts that only exist through a test number are test data.
UPDATE "Contact" k SET "isFixture" = true WHERE EXISTS (
  SELECT 1 FROM "Conversation" c JOIN "PhoneNumber" p ON p.id = c."phoneNumberId" WHERE c."contactId" = k.id AND p."isFixture");

-- Webhook events: workspace and field from the payload's first entry.
UPDATE "WebhookEvent" e SET "orgId" = w."orgId"
  FROM "Waba" w WHERE w."metaWabaId" = (e."rawBody"::jsonb -> 'entry' -> 0 ->> 'id');
UPDATE "WebhookEvent" e SET "field" = (e."rawBody"::jsonb -> 'entry' -> 0 -> 'changes' -> 0 ->> 'field');
