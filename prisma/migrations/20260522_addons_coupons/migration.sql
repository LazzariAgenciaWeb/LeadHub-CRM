-- CreateEnum
CREATE TYPE "AddonType" AS ENUM ('EXTRA_ATENDENTE', 'EXTRA_WHATSAPP');
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable SubscriptionAddon
CREATE TABLE "SubscriptionAddon" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "AddonType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "stripeItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionAddon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionAddon_companyId_type_key" ON "SubscriptionAddon"("companyId", "type");
CREATE INDEX "SubscriptionAddon_companyId_idx" ON "SubscriptionAddon"("companyId");
ALTER TABLE "SubscriptionAddon" ADD CONSTRAINT "SubscriptionAddon_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable Coupon
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "appliesToPlans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_active_idx" ON "Coupon"("active");

-- CreateTable CouponRedemption
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planAtApply" TEXT,
    "amountOff" DOUBLE PRECISION,
    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CouponRedemption_couponId_companyId_key" ON "CouponRedemption"("couponId", "companyId");
CREATE INDEX "CouponRedemption_companyId_idx" ON "CouponRedemption"("companyId");
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
