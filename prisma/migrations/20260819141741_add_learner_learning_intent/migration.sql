-- CreateTable
CREATE TABLE "learner_learning_intent" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "track_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_learning_intent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learner_learning_intent_subject_id_idx" ON "learner_learning_intent"("subject_id");

-- CreateIndex
CREATE INDEX "learner_learning_intent_track_id_idx" ON "learner_learning_intent"("track_id");

-- CreateIndex
CREATE UNIQUE INDEX "learner_learning_intent_user_id_subject_id_key" ON "learner_learning_intent"("user_id", "subject_id");

-- AddForeignKey
ALTER TABLE "learner_learning_intent" ADD CONSTRAINT "learner_learning_intent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_learning_intent" ADD CONSTRAINT "learner_learning_intent_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_learning_intent" ADD CONSTRAINT "learner_learning_intent_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
