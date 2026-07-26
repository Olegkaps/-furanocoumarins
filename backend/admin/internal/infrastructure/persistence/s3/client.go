package s3store

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"admin/settings"
)

func ensureBucket(client *s3.Client, ctx context.Context) error {
	_, err := client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(settings.C.S3Bucket),
	})
	if err == nil {
		return nil
	}
	_, err = client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(settings.C.S3Bucket),
	})
	return err
}

func NewClient(envType string) (*s3.Client, error) {
	if envType == "AUTOTEST" || envType == "TEST" || settings.C.S3Endpoint == "" {
		return nil, nil
	}

	cfg := aws.Config{
		Region: settings.C.S3Region,
		Credentials: credentials.NewStaticCredentialsProvider(
			settings.C.S3AccessKey,
			settings.C.S3SecretKey,
			"",
		),
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(settings.C.S3Endpoint)
		o.UsePathStyle = settings.C.S3UsePathStyle
	})

	if envType != "PROD" {
		if err := ensureBucket(client, context.Background()); err != nil {
			return nil, err
		}
	}

	return client, nil
}
