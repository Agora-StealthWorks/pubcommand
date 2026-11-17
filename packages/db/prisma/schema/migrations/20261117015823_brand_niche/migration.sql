-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "compliance_notes" TEXT,
ADD COLUMN     "niche" TEXT NOT NULL DEFAULT 'general';
