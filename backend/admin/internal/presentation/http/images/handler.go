package images

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"path"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"admin/internal/app"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
	"admin/settings"
)

const (
	prefix            = "admin-images/"
	reservationPrefix = prefix + ".slots/"
	maxImages         = 100
	maxImageBytes     = 5 << 20
	maxImagePixels    = 40_000_000
)

var errImageNotFound = errors.New("image not found")

type imageInfo struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type Handler struct{ deps.Handler }

func NewHandler(container *app.Container) *Handler { return &Handler{Handler: deps.New(container)} }

func (h *Handler) List(c *fiber.Ctx) error {
	if settings.C.S3PublicBaseURL == "" {
		return response.Resp400(c, fmt.Errorf("S3_PUBLIC_BASE_URL is required for the image library"))
	}
	objects, err := h.list(context.Background())
	if err != nil {
		return response.RespErr(c, err)
	}
	return c.JSON(objects)
}

func (h *Handler) Upload(c *fiber.Ctx) error {
	if settings.C.S3PublicBaseURL == "" {
		return response.Resp400(c, fmt.Errorf("S3_PUBLIC_BASE_URL is required for the image library"))
	}
	file, err := c.FormFile("file")
	if err != nil {
		return response.Resp400(c, fmt.Errorf("image file is required"))
	}
	key, info, body, contentType, err := newImage(file.Filename, file.Open)
	if err != nil {
		return response.Resp400(c, err)
	}
	if err := h.Container.Cassandra.WithImageLibraryLock(context.Background(), func() error {
		objects, err := h.list(context.Background())
		if err != nil {
			return err
		}
		if len(objects) >= maxImages {
			return fmt.Errorf("at most %d images are allowed", maxImages)
		}
		slot, err := h.reserve(context.Background())
		if err != nil {
			return err
		}
		reserved := true
		defer func() {
			if reserved {
				_, _ = h.Container.Persistence.S3.DeleteObject(context.Background(), &s3.DeleteObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(slot)})
			}
		}()
		if err := h.put(context.Background(), key, body, contentType, map[string]string{"name": info.Name, "slot": slot}, nil); err != nil {
			return err
		}
		reserved = false
		return nil
	}); err != nil {
		if strings.Contains(err.Error(), "at most") {
			return response.Resp400(c, err)
		}
		return response.RespErr(c, err)
	}
	info.ID, info.URL = strings.TrimPrefix(key, prefix), publicURL(key)
	return c.Status(fiber.StatusCreated).JSON(info)
}

func (h *Handler) Replace(c *fiber.Ctx) error {
	if settings.C.S3PublicBaseURL == "" {
		return response.Resp400(c, fmt.Errorf("S3_PUBLIC_BASE_URL is required for the image library"))
	}
	key := prefix + c.Params("id")
	if !validID(c.Params("id")) {
		return response.Resp404(c)
	}
	file, err := c.FormFile("file")
	if err != nil {
		return response.Resp400(c, fmt.Errorf("image file is required"))
	}
	_, info, body, contentType, err := newImage(file.Filename, file.Open)
	if err != nil {
		return response.Resp400(c, err)
	}
	if err := h.Container.Cassandra.WithImageLibraryLock(context.Background(), func() error {
		existing, err := h.Container.Persistence.S3.HeadObject(context.Background(), &s3.HeadObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key)})
		if err != nil {
			return fmt.Errorf("%w: %v", errImageNotFound, err)
		}
		return h.put(context.Background(), key, body, contentType, map[string]string{"name": info.Name, "slot": existing.Metadata["slot"]}, existing.ETag)
	}); err != nil {
		if errors.Is(err, errImageNotFound) {
			return response.Resp404(c)
		}
		return response.RespErr(c, err)
	}
	info.ID, info.URL = c.Params("id"), publicURL(key)
	return c.JSON(info)
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	if !validID(c.Params("id")) {
		return response.Resp404(c)
	}
	key := prefix + c.Params("id")
	if err := h.Container.Cassandra.WithImageLibraryLock(context.Background(), func() error {
		existing, err := h.Container.Persistence.S3.HeadObject(context.Background(), &s3.HeadObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key)})
		if err != nil {
			return fmt.Errorf("%w: %v", errImageNotFound, err)
		}
		// MinIO's DeleteObject API does not implement the optional S3 If-Match
		// condition. The PostgreSQL lock prevents a stale delete from racing a replacement.
		if _, err = h.Container.Persistence.S3.DeleteObject(context.Background(), &s3.DeleteObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key)}); err != nil {
			return err
		}
		if slot := existing.Metadata["slot"]; slot != "" {
			_, _ = h.Container.Persistence.S3.DeleteObject(context.Background(), &s3.DeleteObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(slot)})
		}
		return nil
	}); err != nil {
		if errors.Is(err, errImageNotFound) {
			return response.Resp404(c)
		}
		return response.RespErr(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) list(ctx context.Context) ([]imageInfo, error) {
	out, err := h.Container.Persistence.S3.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(settings.C.S3Bucket), Prefix: aws.String(prefix), MaxKeys: aws.Int32(2*maxImages + 1)})
	if err != nil {
		return nil, err
	}
	images := make([]imageInfo, 0, len(out.Contents))
	for _, object := range out.Contents {
		key := aws.ToString(object.Key)
		id := strings.TrimPrefix(key, prefix)
		if validID(id) {
			if len(images) == maxImages {
				return nil, fmt.Errorf("image library exceeds its %d-image limit", maxImages)
			}
			head, err := h.Container.Persistence.S3.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key)})
			if err != nil {
				return nil, err
			}
			name := head.Metadata["name"]
			if name == "" {
				name = id
			}
			images = append(images, imageInfo{ID: id, URL: publicURL(key), Name: name, Size: aws.ToInt64(object.Size)})
		}
	}
	return images, nil
}

func (h *Handler) put(ctx context.Context, key string, body []byte, contentType string, metadata map[string]string, ifMatch *string) error {
	_, err := h.Container.Persistence.S3.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key), Body: bytes.NewReader(body), ContentType: aws.String(contentType), Metadata: metadata, IfMatch: ifMatch})
	return err
}

func (h *Handler) reserve(ctx context.Context) (string, error) {
	for slot := 0; slot < maxImages; slot++ {
		key := fmt.Sprintf("%s%d", reservationPrefix, slot)
		_, err := h.Container.Persistence.S3.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(settings.C.S3Bucket), Key: aws.String(key), Body: strings.NewReader("reserved"), IfNoneMatch: aws.String("*")})
		if err == nil {
			return key, nil
		}
		var apiErr smithy.APIError
		if !errors.As(err, &apiErr) || apiErr.ErrorCode() != "PreconditionFailed" {
			return "", err
		}
	}
	return "", fmt.Errorf("at most %d images are allowed", maxImages)
}

func newImage(filename string, open func() (multipart.File, error)) (string, imageInfo, []byte, string, error) {
	f, err := open()
	if err != nil {
		return "", imageInfo{}, nil, "", err
	}
	defer f.Close()
	body, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil {
		return "", imageInfo{}, nil, "", err
	}
	if len(body) == 0 || len(body) > maxImageBytes {
		return "", imageInfo{}, nil, "", fmt.Errorf("image must be no larger than 5 MiB")
	}
	contentType := http.DetectContentType(body)
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/gif" {
		return "", imageInfo{}, nil, "", fmt.Errorf("only PNG, JPEG, and GIF images are allowed")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		return "", imageInfo{}, nil, "", fmt.Errorf("invalid image: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImagePixels/config.Height {
		return "", imageInfo{}, nil, "", fmt.Errorf("image has too many pixels")
	}
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif"}[contentType]
	key := prefix + uuid.NewString() + ext
	return key, imageInfo{Name: path.Base(filename), Size: int64(len(body))}, body, contentType, nil
}

func validID(id string) bool {
	ext := path.Ext(id)
	if ext != ".png" && ext != ".jpg" && ext != ".gif" {
		return false
	}
	_, err := uuid.Parse(strings.TrimSuffix(id, ext))
	return err == nil
}

func publicURL(key string) string {
	return strings.TrimRight(settings.C.S3PublicBaseURL, "/") + "/" + key
}
