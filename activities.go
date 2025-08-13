package app

import (
	"context"
	"fmt"
	"github.com/resend/resend-go/v2"
	"github.com/stripe/stripe-go/v72"
	"github.com/stripe/stripe-go/v72/charge"
	"regexp"
)

type Activities struct {
	StripeKey       string
	ResendApiKey    string
	ResendFromEmail string
	TestEmail       string
}

// Helper function to validate and fix email addresses
func (a *Activities) getValidEmail(email string) string {
	// Simple email validation regex
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	
	if email != "" && emailRegex.MatchString(email) {
		return email
	}
	
	// Return test email if invalid or empty
	fmt.Printf("Using test email instead of invalid email: '%s'\n", email)
	return a.TestEmail
}

func (a *Activities) CreateStripeCharge(_ context.Context, cart CartState) error {
	stripe.Key = a.StripeKey
	var amount float32 = 0
	var description string = ""
	for _, item := range cart.Items {
		var product Product
		for _, _product := range Products {
			if _product.Id == item.ProductId {
				product = _product
				break
			}
		}
		amount += float32(item.Quantity) * product.Price
		if len(description) > 0 {
			description += ", "
		}
		description += product.Name
	}

	validEmail := a.getValidEmail(cart.Email)
	
	_, err := charge.New(&stripe.ChargeParams{
		Amount:       stripe.Int64(int64(amount * 100)),
		Currency:     stripe.String(string(stripe.CurrencyUSD)),
		Description:  stripe.String(description),
		Source:       &stripe.SourceParams{Token: stripe.String("tok_visa")},
		ReceiptEmail: stripe.String(validEmail),
	})

	if err != nil {
		fmt.Println("Stripe err: " + err.Error())
	}

	return err
}

func (a *Activities) SendAbandonedCartEmail(_ context.Context, email string) error {
	validEmail := a.getValidEmail(email)
	
	client := resend.NewClient(a.ResendApiKey)
	
	params := &resend.SendEmailRequest{
		From:    a.ResendFromEmail,
		To:      []string{validEmail},
		Subject: "You've abandoned your shopping cart!",
		Html:    "<p>Go to <a href=\"http://localhost:8080\">http://localhost:8080</a> to finish checking out!</p>",
	}
	
	_, err := client.Emails.Send(params)
	if err != nil {
		fmt.Println("Resend err: " + err.Error())
		return err
	}

	return nil
}
