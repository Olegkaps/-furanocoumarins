package images

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
	"admin/settings"
)

type memoryFile struct{ *bytes.Reader }

func (memoryFile) Close() error { return nil }

func TestNewImageAcceptsDecodedPNGAndGeneratesOpaqueObjectID(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WAAAAABJRU5ErkJggg==")
	require.NoError(t, err)
	key, info, body, contentType, err := newImage("photo.png", func() (multipart.File, error) { return memoryFile{bytes.NewReader(png)}, nil })
	require.NoError(t, err)
	require.True(t, validID(key[len(prefix):]))
	require.Equal(t, "image/png", contentType)
	require.Equal(t, int64(len(png)), info.Size)
	require.Equal(t, png, body)
}

func TestNewImageRejectsNonImageContent(t *testing.T) {
	_, _, _, _, err := newImage("not-an-image.txt", func() (multipart.File, error) { return memoryFile{bytes.NewReader([]byte("not an image"))}, nil })
	require.Error(t, err)
}

func TestNewImageRejectsExcessiveDecodedPixels(t *testing.T) {
	png := make([]byte, 33)
	copy(png, []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
	binary.BigEndian.PutUint32(png[16:20], 10_000)
	binary.BigEndian.PutUint32(png[20:24], 10_000)
	png[24] = 8
	png[25] = 2
	_, _, _, _, err := newImage("large.png", func() (multipart.File, error) { return memoryFile{bytes.NewReader(png)}, nil })
	require.Error(t, err)
}

var _ io.Reader = memoryFile{}

type storedImage struct {
	body     []byte
	metadata map[string]string
	etag     string
}
type fakeS3 struct {
	objects                        map[string]storedImage
	replaceDeleted, deleteReplaced bool
	rejectConditionalDelete        bool
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/bucket/")
	if r.Method == http.MethodGet && r.URL.Query().Has("list-type") {
		keys := make([]string, 0, len(f.objects))
		for key := range f.objects {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		w.Header().Set("Content-Type", "application/xml")
		_, _ = io.WriteString(w, "<ListBucketResult>")
		for _, key := range keys {
			_, _ = io.WriteString(w, "<Contents><Key>"+key+"</Key><Size>"+"1"+"</Size></Contents>")
		}
		_, _ = io.WriteString(w, "</ListBucketResult>")
		return
	}
	object, found := f.objects[key]
	switch r.Method {
	case http.MethodHead:
		if !found {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("ETag", object.etag)
		for name, value := range object.metadata {
			w.Header().Set("x-amz-meta-"+name, value)
		}
		if f.deleteReplaced {
			object.etag = `"replaced"`
			f.objects[key] = object
			f.deleteReplaced = false
		}
	case http.MethodPut:
		if r.Header.Get("If-None-Match") == "*" && found {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		if f.replaceDeleted && r.Header.Get("If-Match") != "" {
			delete(f.objects, key)
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		if r.Header.Get("If-Match") != "" && (!found || r.Header.Get("If-Match") != object.etag) {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		body, _ := io.ReadAll(r.Body)
		metadata := map[string]string{}
		for name, values := range r.Header {
			if strings.HasPrefix(strings.ToLower(name), "x-amz-meta-") {
				metadata[strings.TrimPrefix(strings.ToLower(name), "x-amz-meta-")] = values[0]
			}
		}
		f.objects[key] = storedImage{body: body, metadata: metadata, etag: `"next"`}
		w.Header().Set("ETag", `"next"`)
	case http.MethodDelete:
		if f.rejectConditionalDelete && r.Header.Get("If-Match") != "" {
			w.WriteHeader(http.StatusNotImplemented)
			return
		}
		if r.Header.Get("If-Match") != "" && (!found || r.Header.Get("If-Match") != object.etag) {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		delete(f.objects, key)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func imageApp(t *testing.T, store *fakeS3) *fiber.App {
	t.Helper()
	server := httptest.NewServer(store)
	t.Cleanup(server.Close)
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)
	container.Persistence.S3 = s3.New(s3.Options{Region: "us-east-1", BaseEndpoint: &server.URL, UsePathStyle: true, Credentials: credentials.NewStaticCredentialsProvider("id", "secret", "")})
	previous := settings.C
	settings.C.S3Bucket = "bucket"
	settings.C.S3PublicBaseURL = "https://images.example.test/bucket"
	t.Cleanup(func() { settings.C = previous })
	handler := NewHandler(container)
	application := fiber.New()
	application.Get("/admin/images", handler.List)
	application.Post("/admin/images", handler.Upload)
	application.Put("/admin/images/:id", handler.Replace)
	application.Delete("/admin/images/:id", handler.Delete)
	return application
}

func imageRequest(t *testing.T, method, target, filename string, body []byte) *http.Request {
	t.Helper()
	var requestBody io.Reader
	contentType := ""
	if filename != "" {
		var form bytes.Buffer
		writer := multipart.NewWriter(&form)
		part, err := writer.CreateFormFile("file", filename)
		require.NoError(t, err)
		_, err = part.Write(body)
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		requestBody, contentType = &form, writer.FormDataContentType()
	}
	req := httptest.NewRequest(method, target, requestBody)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return req
}

func TestImageHandlerUploadReplaceListAndDelete(t *testing.T) {
	store := &fakeS3{objects: map[string]storedImage{}, rejectConditionalDelete: true}
	application := imageApp(t, store)
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WAAAAABJRU5ErkJggg==")
	response, err := application.Test(imageRequest(t, http.MethodPost, "/admin/images", "first.png", png))
	require.NoError(t, err)
	require.Equal(t, http.StatusCreated, response.StatusCode)
	var created imageInfo
	require.NoError(t, json.NewDecoder(response.Body).Decode(&created))
	require.Equal(t, "first.png", created.Name)
	require.Equal(t, "https://images.example.test/bucket/admin-images/"+created.ID, created.URL)
	response, err = application.Test(imageRequest(t, http.MethodPut, "/admin/images/"+created.ID, "changed.png", png))
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode)
	response, err = application.Test(imageRequest(t, http.MethodGet, "/admin/images", "", nil))
	require.NoError(t, err)
	var listed []imageInfo
	require.NoError(t, json.NewDecoder(response.Body).Decode(&listed))
	require.Len(t, listed, 1)
	require.Equal(t, "changed.png", listed[0].Name)
	require.Equal(t, created.URL, listed[0].URL)
	response, err = application.Test(imageRequest(t, http.MethodDelete, "/admin/images/"+created.ID, "", nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusNoContent, response.StatusCode)
}

func TestImageHandlerRejectsUploadAtQuota(t *testing.T) {
	store := &fakeS3{objects: map[string]storedImage{}}
	for index := 0; index < maxImages; index++ {
		id := uuid.NewString() + ".png"
		store.objects[prefix+id] = storedImage{etag: `"old"`}
	}
	application := imageApp(t, store)
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WAAAAABJRU5ErkJggg==")
	response, err := application.Test(imageRequest(t, http.MethodPost, "/admin/images", "extra.png", png))
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, response.StatusCode)
}

func TestImageHandlerDoesNotRecreateAfterConcurrentDelete(t *testing.T) {
	id := uuid.NewString() + ".png"
	store := &fakeS3{objects: map[string]storedImage{prefix + id: {etag: `"old"`, metadata: map[string]string{"slot": reservationPrefix + "0"}}}, replaceDeleted: true}
	application := imageApp(t, store)
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WAAAAABJRU5ErkJggg==")
	response, err := application.Test(imageRequest(t, http.MethodPut, "/admin/images/"+id, "new.png", png))
	require.NoError(t, err)
	require.GreaterOrEqual(t, response.StatusCode, http.StatusInternalServerError)
	_, exists := store.objects[prefix+id]
	require.False(t, exists)
}

func TestImageHandlerReturnsNotFoundForMissingMutationTarget(t *testing.T) {
	application := imageApp(t, &fakeS3{objects: map[string]storedImage{}})
	id := uuid.NewString() + ".png"
	response, err := application.Test(imageRequest(t, http.MethodDelete, "/admin/images/"+id, "", nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusNotFound, response.StatusCode)
}
