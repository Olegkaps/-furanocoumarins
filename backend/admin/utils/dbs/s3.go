package dbs

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"admin/settings"
)

// EnsureBucket creates the configured bucket if it does not exist. Safe to call repeatedly.
func ensureBucket(client *s3.Client, ctx context.Context) error {
	_, err := client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(settings.S3_BUCKET),
	})
	if err == nil {
		return nil
	}
	_, err = client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(settings.S3_BUCKET),
	})
	return err
}

func mustLoadS3Client() *s3.Client {
	if settings.ENV_TYPE == "AUTOTEST" || settings.S3_ENDPOINT == "" {
		return nil
	}

	cfg := aws.Config{
		Region: settings.S3_REGION,
		Credentials: credentials.NewStaticCredentialsProvider(
			settings.S3_ACCESS_KEY,
			settings.S3_SECRET_KEY,
			"",
		),
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(settings.S3_ENDPOINT)
		o.UsePathStyle = settings.S3_USE_PATH_STYLE
	})

	if settings.ENV_TYPE != "PROD" {
		err := ensureBucket(client, context.Background())
		if err != nil {
			panic(err)
		}
	}

	return client
}

var S3Client *s3.Client = mustLoadS3Client()
