package main

// registeredSchemas are schema files that live beside the feature they serve
// and apply themselves, after auth_schema.sql and media_schema.sql, when the
// server starts (see migrate). A new table is then a new .sql file and one
// registerSchema call in its own .go file — not another edit to migrate.
var registeredSchemas []string

// registerSchema adds an idempotent schema to the startup migration. Call it
// from an init function; order between registered schemas is file order.
func registerSchema(schema string) {
	registeredSchemas = append(registeredSchemas, schema)
}
