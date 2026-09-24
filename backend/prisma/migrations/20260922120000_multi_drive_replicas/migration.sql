-- DropIndex
DROP INDEX "Chunk_file_id_chunk_index_key";

-- AlterTable
ALTER TABLE "Drive" ADD COLUMN     "google_email" VARCHAR(255),
ADD COLUMN     "refresh_token_encrypted" TEXT,
ADD COLUMN     "sync_page_token" VARCHAR(255);

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'ready';

-- AlterTable
ALTER TABLE "Chunk" ALTER COLUMN "checksum" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_file_id_chunk_index_drive_id_key" ON "Chunk"("file_id", "chunk_index", "drive_id");

