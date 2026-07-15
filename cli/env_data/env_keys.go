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
			"ENV_TYPE": "DEV",
			"PG_USER": "postgres",
			"PG_PASSWORD": "password",
			"PG_DB": "mydb",
			"PG_HOST": "postgres",
			"PG_PORT": "5432",
			"PG_SSLMODE": "disable",
			"REDIS_ADDR": "redis:6379",
			"REDIS_PASSWORD": "password",
			"CASSANDRA_HOST": "cassandra",
			"DOMAIN_PREF": "http://localhost:5173",
			"MAIL": "name@example.com",
			"MAIL_SECRET": "xxxxxxx",
			"SMTP_HOST": "smtp.yandex.ru",
			"SMTP_PORT": "587",
			"S3_ENDPOINT": "http://minio:9000",
			"S3_ACCESS_KEY_ID": "minioadmin",
			"S3_SECRET_ACCESS_KEY": "minioadmin",
			"S3_BUCKET": "pages",
			"S3_REGION": "us-east-1",
			"S3_USE_PATH_STYLE": "true",
			"SEARCH_CACHE_TTL": "5m",
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