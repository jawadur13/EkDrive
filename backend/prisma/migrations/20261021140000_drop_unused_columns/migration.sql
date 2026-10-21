-- DropForeignKey
ALTER TABLE "AuthToken" DROP CONSTRAINT "AuthToken_user_id_fkey";

-- AlterTable
ALTER TABLE "File" DROP COLUMN "drive_assignments",
DROP COLUMN "google_file_ids";

-- DropTable
DROP TABLE "AuthToken";

