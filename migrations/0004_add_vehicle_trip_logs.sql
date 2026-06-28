CREATE TABLE "vehicle_trip_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid,
	"funeral_case_id" uuid,
	"trip_date" date NOT NULL,
	"purpose" text,
	"start_location" text,
	"destination" text,
	"start_odometer" integer,
	"end_odometer" integer,
	"distance_km" integer,
	"time_departed" text,
	"time_returned" text,
	"fuel_used_litres" numeric(6, 2),
	"driver_notes" text,
	"authorized_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_trip_logs" ADD CONSTRAINT "vehicle_trip_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trip_logs" ADD CONSTRAINT "vehicle_trip_logs_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trip_logs" ADD CONSTRAINT "vehicle_trip_logs_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trip_logs" ADD CONSTRAINT "vehicle_trip_logs_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vtl_vehicle_idx" ON "vehicle_trip_logs" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vtl_org_idx" ON "vehicle_trip_logs" USING btree ("organization_id");