-- CreateTable
CREATE TABLE "processed_jobs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_jobs_pkey" PRIMARY KEY ("id")
);
