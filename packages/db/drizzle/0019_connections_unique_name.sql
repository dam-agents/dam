CREATE UNIQUE INDEX "connections_owner_name_unique_idx" ON "connections" USING btree ("owner","name");
