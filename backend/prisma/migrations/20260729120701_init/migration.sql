-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "avatar_url" TEXT,
    "storage_mode" VARCHAR(20) NOT NULL DEFAULT 'balanced',
    "max_storage_gb" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expiry" TIMESTAMP(6) NOT NULL,
    "scopes" TEXT[],
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(6),

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drive" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "drive_name" VARCHAR(255) NOT NULL,
    "google_drive_id" VARCHAR(255) NOT NULL,
    "drive_type" VARCHAR(20) NOT NULL DEFAULT 'personal',
    "root_folder_id" VARCHAR(255) NOT NULL,
    "total_quota_bytes" BIGINT,
    "used_quota_bytes" BIGINT,
    "available_quota_bytes" BIGINT,
    "oauth_token_encrypted" TEXT NOT NULL,
    "token_expiry" TIMESTAMP(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'online',
    "last_health_check" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Drive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(1024) NOT NULL,
    "virtual_path" TEXT NOT NULL,
    "is_folder" BOOLEAN NOT NULL DEFAULT false,
    "mime_type" VARCHAR(255),
    "size_bytes" BIGINT,
    "checksum" VARCHAR(64),
    "google_file_ids" TEXT[],
    "drive_assignments" JSONB,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "is_chunked" BOOLEAN NOT NULL DEFAULT false,
    "redundancy_copies" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "google_file_id" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "upload_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageMode" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mode" VARCHAR(20) NOT NULL DEFAULT 'balanced',
    "min_replicas" INTEGER NOT NULL DEFAULT 1,
    "rebalance_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "latency_ms" INTEGER,
    "quota_available" BIGINT,
    "error_message" TEXT,
    "checked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEntry" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_id" UUID,
    "drive_id" UUID,
    "google_file_id" VARCHAR(255),
    "operation" VARCHAR(20) NOT NULL,
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "conflict_resolution" VARCHAR(20),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(6),

    CONSTRAINT "SyncEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(6),
    "max_downloads" INTEGER,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "permissions" VARCHAR(20) NOT NULL DEFAULT 'view',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_user_id_key" ON "AuthToken"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Drive_google_drive_id_key" ON "Drive"("google_drive_id");

-- CreateIndex
CREATE INDEX "Drive_user_id_idx" ON "Drive"("user_id");

-- CreateIndex
CREATE INDEX "Drive_status_idx" ON "Drive"("status");

-- CreateIndex
CREATE INDEX "File_user_id_idx" ON "File"("user_id");

-- CreateIndex
CREATE INDEX "File_parent_id_idx" ON "File"("parent_id");

-- CreateIndex
CREATE INDEX "File_virtual_path_idx" ON "File"("virtual_path");

-- CreateIndex
CREATE INDEX "Chunk_file_id_idx" ON "Chunk"("file_id");

-- CreateIndex
CREATE INDEX "Chunk_drive_id_idx" ON "Chunk"("drive_id");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_file_id_chunk_index_key" ON "Chunk"("file_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "StorageMode_user_id_key" ON "StorageMode"("user_id");

-- CreateIndex
CREATE INDEX "HealthCheck_drive_id_idx" ON "HealthCheck"("drive_id");

-- CreateIndex
CREATE INDEX "HealthCheck_checked_at_idx" ON "HealthCheck"("checked_at");

-- CreateIndex
CREATE INDEX "SyncEntry_user_id_idx" ON "SyncEntry"("user_id");

-- CreateIndex
CREATE INDEX "SyncEntry_sync_status_idx" ON "SyncEntry"("sync_status");

-- CreateIndex
CREATE INDEX "SyncEntry_drive_id_idx" ON "SyncEntry"("drive_id");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_token_idx" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_user_id_idx" ON "ShareLink"("user_id");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drive" ADD CONSTRAINT "Drive_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "Drive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageMode" ADD CONSTRAINT "StorageMode_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "Drive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEntry" ADD CONSTRAINT "SyncEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEntry" ADD CONSTRAINT "SyncEntry_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEntry" ADD CONSTRAINT "SyncEntry_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "Drive"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
