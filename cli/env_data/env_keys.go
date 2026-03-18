package env_data

type EnvKeys struct {
	Filename string
	Keys     map[string]string
}

func GetEnvKeys() []EnvKeys{
	return []EnvKeys{
	{
		Filename: ".env",
		Keys:     map[string]string{
			"SECRET_KEY": "xxxxxxx",
			"ALLOW_ORIGIN": "*",
			"REDIS_PASSWORD": "password",
			"PG_USER": "postgres",
			"PG_PASSWORD": "password",
			"PG_DB": "mydb",
			"CASSANDRA_HOST": "cassandra",
			"MAIL": "name@example.com",
			"MAIL_SECRET": "xxxxxxx",
			"DOMAIN_PREF": "http://localhost:5173",
			"S3_ENDPOINT": "http://minio:9000",
			"S3_ACCESS_KEY_ID": "minioadmin",
			"S3_SECRET_ACCESS_KEY": "minioadmin",
			"S3_BUCKET": "pages",
			"S3_REGION": "us-east-1",
			"ENV_TYPE": "DEV",
		},
	},
	{
		Filename: "cassandra.env",
		Keys:     map[string]string{
			"DATA_EXPLORER_CONFIG_NAME": "ADMIN",
			"CASSANDRA_HOST": "cassandra",
			"REDIS_HOST": "redis",
		},
	},
	{
		Filename: "redis.env",
		Keys:     map[string]string{
			"REDIS_PASSWORD": "password",
		},
	},
	{
		Filename: "postgres.env",
		Keys:     map[string]string{
			"POSTGRES_DB": "mydb",
			"POSTGRES_USER": "postgres",
			"POSTGRES_PASSWORD": "password",
		},
	},
	{
		Filename: "grafana.env",
		Keys:     map[string]string{
			"GF_SECURITY_ADMIN_USER": "admin",
			"GF_SECURITY_ADMIN_PASSWORD": "admin",
		},
		},
	}
}