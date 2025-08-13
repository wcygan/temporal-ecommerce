package app

import (
	"context"
	"fmt"
	"github.com/resend/resend-go/v2"
	"github.com/stripe/stripe-go/v72"
	"github.com/stripe/stripe-go/v72/charge"
)

type Activities struct {
	StripeKey     string
	ResendApiKey  string
	ResendFromEmail string
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

	_, err := charge.New(&stripe.ChargeParams{
		Amount:       stripe.Int64(int64(amount * 100)),
		Currency:     stripe.String(string(stripe.CurrencyUSD)),
		Description:  stripe.String(description),
		Source:       &stripe.SourceParams{Token: stripe.String("tok_visa")},
		ReceiptEmail: stripe.String(cart.Email),
	})

	if err != nil {
		fmt.Println("Stripe err: " + err.Error())
	}

	return err
}

func (a *Activities) SendAbandonedCartEmail(_ context.Context, email string) error {
	if email == "" {
		return nil
	}
	
	client := resend.NewClient(a.ResendApiKey)
	
	params := &resend.SendEmailRequest{
		From:    a.ResendFromEmail,
		To:      []string{email},
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
